import { randomBytes } from "node:crypto";
import type { Role } from "@mastra-cc/protocol-types";
import { type BackendChange, type ChannelWatch, DeafWatchError } from "../../backend.js";
import type { Exchange } from "./channel.js";
import { deriveId } from "./identity.js";

// The accessibility stream, honestly scoped (ADR-0039).
//
// This module subscribes to the ONE signal class the M0.5 spike actually
// observed to fire: Object.StateChanged. The spike registered for window-level
// signals too and none ever arrived - recorded as observed, not explained
// (docs/proofs/can-node-be-told-the-desktop-changed.md) - so nothing here
// registers for a signal class this repo has never seen fire, and nothing
// claims to report one.
//
// Attribution is by D-BUS SENDER NAME, never by matching text in a payload:
// window titles are not what these signals carry (the spike's first version
// searched bodies for a title, found nothing, and refused). The sender is the
// owning application's bus connection - the same fact the walk keys identity
// on - and it is what decides whether a signal belongs to the watched root's
// application at all.
//
// THE SUBSCRIPTION PROVES ITSELF ALIVE BEFORE IT IS RETURNED. The spike's
// other finding: the match rule and the registry registration are both
// required, and missing either fails SILENTLY - a deaf subscriber sits
// quietly forever and looks identical to a calm desktop. So at subscribe time
// this module causes its own signal and requires it to arrive within a
// bounded budget. The subscription is the thing under test and cannot also be
// the judge, which is why only the deliberately-caused probe - identified by
// a nonce minted for this one subscribe - satisfies the check: an ambient
// signal arriving in the window is not evidence that OUR registrations took.

const EVENT_OBJECT_IFACE = "org.a11y.atspi.Event.Object";
const STATE_CHANGED = "StateChanged";
const TEXT_CHANGED = "TextChanged";

// The two signal classes this repo has watched fire on a live bus. StateChanged
// came from the M0.5 spike; TextChanged came from a live Kate observation on
// 2026-08-28, where an edit through the daemon produced text-changed:delete and
// text-changed:insert about 4ms later and produced NO state-changed at all - so
// a watch registered only for state changes was deaf to exactly the mutation
// this milestone is about. Nothing here registers for a class never seen fire.
//
// TextChanged bodies carry the inserted/deleted text. THE PAYLOAD IS NEVER READ.
// A change event is a pointer: it says which element changed, and the client
// learns what it now says by making a fresh authorized observation. Reading the
// body here would put observed content on the event path, which the contract
// forbids outright - so the body is not parsed, not logged, not forwarded.
const WATCHED_MEMBERS = [STATE_CHANGED, TEXT_CHANGED] as const;
const REGISTRATIONS: ReadonlyArray<{ member: string; event: string }> = [
  { member: STATE_CHANGED, event: "object:state-changed" },
  { member: TEXT_CHANGED, event: "object:text-changed" },
];

// The probe signal's object path. Ours, not AT-SPI's: no accessible object
// lives here, so a probe can never be mistaken for a change in any subtree.
export const PROBE_PATH = "/org/mastra_cc/probe";

// How long the self-caused probe may take to come back. The spike measured
// 138ms to the first signal on a live bus; this is an order of magnitude of
// headroom, and a bus that cannot echo a signal in two seconds is not a bus
// this daemon should claim to be watching.
const PROBE_BUDGET_MS = 2000;

// Ambient-noise backstop. The spike counted 18 signals in a QUIET 3-second
// window; sender scope drops nearly all of them at the source, and this
// per-element collapse is only the backstop behind it. A hit is recorded on
// the daemon's own log - never on the wire, which has no field for it.
const BACKSTOP_WINDOW_MS = 100;

// How far a signal may be from the watched root before this route stops
// trying to place it. The same ceiling the walk descends to, read from the
// other direction.
const MAX_CLIMB = 24;

export interface IncomingSignal {
  sender: string;
  path: string;
  iface: string;
  member: string;
  body: unknown[];
}

// What the stream needs from a bus, and nothing more. The live channel wires
// the real accessibility bus in; the tests wire in a fake. Registrations ride
// the same call() seam every other exchange uses, so a capture records them
// and a failed registration call is loud on its own.
export interface SignalBusOps {
  call(exchange: Exchange): Promise<unknown[]>;
  emit(msg: { path: string; iface: string; member: string; signature: string; body: unknown[] }): void;
  onSignal(listener: (signal: IncomingSignal) => void): () => void;
}

// What the backend knows about the watched root that the stream cannot derive
// on its own: which bus connection owns it, and which (busName, objectPath)
// pairs the walk has already answered - so a change to an element the client
// has actually seen is reported under the SAME id the walk gave it.
export interface AtspiWatchAnchor {
  busName: string;
  // The watched root's own object path - the top of the only subtree this
  // watch speaks for.
  rootPath: string;
  known(busName: string, objectPath: string): { id: string; role: Role } | undefined;
  // One step up the tree. Undefined at the top, or on an element that will
  // not answer; either way the climb ends and the signal is not delivered.
  parentOf(busName: string, objectPath: string): Promise<{ busName: string; objectPath: string } | undefined>;
}

const REGISTRY_DEST = "org.a11y.atspi.Registry";
const REGISTRY_PATH = "/org/a11y/atspi/registry";

export async function openSignalStream(
  ops: SignalBusOps,
  subscribedTo: string,
  anchor: AtspiWatchAnchor,
  sink: (change: BackendChange) => void,
  probeBudgetMs: number = PROBE_BUDGET_MS,
): Promise<ChannelWatch> {
  // Both registrations, both on the call() seam. The bus-side match rule is
  // what makes signals reach this connection; the registry-side registration
  // is what makes applications emit them at all. Missing either is the silent
  // failure the probe below exists to catch.
  for (const registration of REGISTRATIONS) {
    await ops.call({
      destination: "org.freedesktop.DBus",
      path: "/org/freedesktop/DBus",
      iface: "org.freedesktop.DBus",
      member: "AddMatch",
      signature: "s",
      body: [`type='signal',interface='${EVENT_OBJECT_IFACE}',member='${registration.member}'`],
    });
    await ops.call({
      destination: REGISTRY_DEST,
      path: REGISTRY_PATH,
      iface: "org.a11y.atspi.Registry",
      member: "RegisterEvent",
      signature: "s",
      body: [registration.event],
    });
  }

  const nonce = randomBytes(8).toString("hex");
  // Each registered signal class proves itself separately. A watch that hears
  // state changes but is deaf to text changes is exactly the silent half-failure
  // this probe exists to catch, so every member must echo before the watch is
  // handed back.
  const unheard = new Set<string>(REGISTRATIONS.map((registration) => registration.member));
  let resolveProbe: () => void = () => undefined;
  const probeArrived = new Promise<void>((resolve) => {
    resolveProbe = resolve;
  });

  let open = true;
  // Changes arriving between registration and the probe's verdict are held,
  // not dropped and not delivered: if the probe confirms, they flush in
  // arrival order; if it refuses, no watch ever existed to deliver them to.
  let pending: BackendChange[] | null = [];
  const lastEmitted = new Map<string, number>();

  // SUBTREE SCOPE (Jamie, 2026-08-28): "you subscribe to state changes on an
  // element that means you get a signal when ever its content or properties or
  // any of its children their properites or content changes. anything outside
  // of that element does not trigger a signal."
  //
  // AT-SPI object paths are opaque handles, not hierarchical names, so there is
  // nothing to prefix-match: `/org/a11y/atspi/accessible/42` says nothing about
  // what contains it. Descent is what the walk does, so it never needs to ask
  // for a parent - but a signal names a node the walk may never have visited,
  // and the only way to place it is to climb from it and see whether the
  // watched root is on the way up.
  //
  // A climb that ends anywhere else - the application root, an element that
  // will not answer, the depth ceiling - is not proof of being outside so much
  // as an absence of proof of being inside, and this route does not deliver on
  // an absence of proof. Silence is the honest answer.
  const ancestry = new Map<string, boolean>();
  const withinSubtree = async (path: string): Promise<boolean> => {
    const memo = ancestry.get(path);
    if (memo !== undefined) return memo;
    const climbed: string[] = [];
    let here = path;
    let verdict = false;
    // The same ceiling the walk uses. A tree deeper than this is not a tree
    // this daemon claims to have understood.
    for (let step = 0; step <= MAX_CLIMB; step += 1) {
      const seen = ancestry.get(here);
      if (seen !== undefined) {
        verdict = seen;
        break;
      }
      if (here === anchor.rootPath) {
        verdict = true;
        break;
      }
      climbed.push(here);
      const parent = await anchor.parentOf(anchor.busName, here);
      if (parent === undefined || parent.busName !== anchor.busName) break;
      here = parent.objectPath;
    }
    // Every node on the path just climbed shares the verdict: they are all
    // inside the subtree, or none of them is.
    for (const step of climbed) ancestry.set(step, verdict);
    ancestry.set(path, verdict);
    return verdict;
  };

  let queue: Promise<void> = Promise.resolve();

  const deliver = (change: BackendChange) => {
    // The backstop: one change per element per window. Scope is the design;
    // this only catches what scope let through.
    const now = Date.now();
    const last = lastEmitted.get(change.id);
    lastEmitted.set(change.id, now);
    if (last !== undefined && now - last < BACKSTOP_WINDOW_MS) {
      console.error(`atspi-stream: backstop collapsed a repeat change for ${change.id} - scope let ambient noise through`);
      return;
    }
    if (pending !== null) {
      pending.push(change);
      return;
    }
    sink(change);
  };

  const detach = ops.onSignal((signal) => {
    if (signal.iface !== EVENT_OBJECT_IFACE) return;
    if (!(WATCHED_MEMBERS as readonly string[]).includes(signal.member)) return;
    if (signal.path === PROBE_PATH) {
      // Only this subscribe's own nonce is evidence. Anything else on the
      // probe path - another subscription's probe, a coincidence - is not.
      if (String(signal.body[0] ?? "") === nonce) {
        unheard.delete(signal.member);
        if (unheard.size === 0) resolveProbe();
      }
      return;
    }
    if (!open) return;
    // Sender scope: a signal from any other application's connection is not
    // this watch's business and produces nothing. This is also where an
    // ungranted application's signals die at this layer - its elements were
    // never answered, so no watch can anchor inside it - and the server
    // re-checks visibility at emission besides.
    if (signal.sender !== anchor.busName) return;
    // Subtree scope. Deciding it means climbing the bus, which is async, so
    // the decisions are chained: signals are scoped and delivered in the order
    // they arrived rather than in whichever order the bus answers.
    queue = queue.then(async () => {
      if (!open) return;
      if (!(await withinSubtree(signal.path))) return;
      const known = anchor.known(signal.sender, signal.path);
      // An element the walk never answered still changed; it is reported under
      // a derived id with the generic role - the same answer the walk gives a
      // role it cannot map (ADR-0018 clause 3) - never invented, never guessed.
      const id = known?.id ?? deriveId("generic", signal.sender, signal.path);
      const role = known?.role ?? "generic";
      deliver({ id, role, kind: "changed" });
    });
  });

  for (const registration of REGISTRATIONS) {
    ops.emit({ path: PROBE_PATH, iface: EVENT_OBJECT_IFACE, member: registration.member, signature: "s", body: [nonce] });
  }

  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    probeArrived,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, probeBudgetMs);
    }),
  ]);
  clearTimeout(timer);

  if (unheard.size > 0) {
    detach();
    pending = null;
    throw new DeafWatchError(
      `the accessibility route registered for its signals, caused one of its own, and never heard ${[...unheard].join(", ")} within ${probeBudgetMs}ms - refusing to hand back a watch that may never speak (element "${subscribedTo}")`,
    );
  }

  // Confirmed alive: flush what arrived while the probe was out, in order.
  const held = pending;
  pending = null;
  for (const change of held ?? []) sink(change);

  return {
    async close() {
      open = false;
      detach();
    },
  };
}

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
  // Whether the object still hangs in the tree, asked of the bus directly:
  // "attached" when it reports a parent, "detached" when it answers and
  // reports none. Rejects when it does not answer - which is unknown, not
  // detached. Optional so scripted anchors that never remove a root need not
  // model it; without it a root's removal is only known by its own defunct.
  attachmentOf?(busName: string, objectPath: string): Promise<"attached" | "detached">;
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
  const trailing = new Map<string, { change: BackendChange; timer: ReturnType<typeof setTimeout> }>();
  const dropTrailing = () => {
    for (const held of trailing.values()) clearTimeout(held.timer);
    trailing.clear();
  };

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
  // Membership is fresh per signal. Unreadable parents, cycles and exhausted
  // climbs are unknown, not durable negative evidence. Only inside may emit.
  const withinSubtree = async (path: string): Promise<"inside" | "outside" | "unknown"> => {
    const visited = new Set<string>();
    let here = path;
    for (let step = 0; step <= MAX_CLIMB; step += 1) {
      if (!open) return "unknown";
      if (here === anchor.rootPath) return "inside";
      if (step === MAX_CLIMB || visited.has(here)) return "unknown";
      visited.add(here);
      let parent;
      try {
        parent = await anchor.parentOf(anchor.busName, here);
      } catch {
        return "unknown";
      }
      if (parent === undefined) return "unknown";
      if (parent.busName !== anchor.busName) return "outside";
      here = parent.objectPath;
    }
    return "unknown";
  };

  // Has the root left the tree? Measured live (cc08/reparent): when GTK
  // destroys a window, the children are unparented BEFORE the window's own
  // defunct is announced, and the child itself never says defunct. So when a
  // defunct arrives from this application, the question is "does my root
  // still hang anywhere" - asked of the bus now, not of any cache. A root
  // that answers with no parent has left the tree; every live object has
  // one, up to the registry's desktop. A root that does not answer at all is
  // unknown, and unknown ends nothing.
  const rootLeftTheTree = async (): Promise<boolean> => {
    if (anchor.attachmentOf === undefined) return false;
    try {
      return (await anchor.attachmentOf(anchor.busName, anchor.rootPath)) === "detached";
    } catch {
      return false;
    }
  };

  let queue: Promise<void> = Promise.resolve();

  const emit = (change: BackendChange) => {
    lastEmitted.set(change.id, Date.now());
    if (pending !== null) {
      pending.push(change);
      return;
    }
    sink(change);
  };

  const deliver = (change: BackendChange) => {
    // The backstop: one change per element per window. Scope is the design;
    // this only catches what scope let through.
    //
    // The window is measured from the last EMISSION, not the last arrival, and
    // the newest collapsed change is held for a trailing emission when the
    // window ends. A traced typing session (cc09/load) showed why: a person
    // typing keeps every gap under the window, and measuring from arrival
    // kept the window open for the whole paragraph - 417 changes collapsed,
    // one delivered, and the final state of the element never announced. A
    // watch that goes silent under sustained change is the deaf watch this
    // route refuses to hand back; the backstop must not create one.
    const now = Date.now();
    const last = lastEmitted.get(change.id);
    if (last !== undefined && now - last < BACKSTOP_WINDOW_MS) {
      const held = trailing.get(change.id);
      if (held !== undefined) {
        held.change = change;
        return;
      }
      console.error(`atspi-stream: backstop collapsed a repeat change for ${change.id} - trailing emission scheduled`);
      const timer = setTimeout(() => {
        const latest = trailing.get(change.id);
        trailing.delete(change.id);
        if (!open || latest === undefined) return;
        emit(latest.change);
      }, last + BACKSTOP_WINDOW_MS - now);
      timer.unref();
      trailing.set(change.id, { change, timer });
      return;
    }
    emit(change);
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
    // The root's death. AT-SPI announces a destroyed accessible with
    // StateChanged("defunct", 1) - on the root itself, or (GTK, measured
    // live in cc08/reparent) only on the window around it while the root is
    // silently unparented. Either way the watch ends, says which element it
    // watched, and is never re-anchored onto whatever takes the place
    // (ADR-0039). Nothing here ends a watch on a guess: an unreadable parent
    // is unknown, and unknown is not gone.
    const isDefunct = signal.member === STATE_CHANGED && signal.body[0] === "defunct" && Number(signal.body[1]) === 1;
    // Subtree scope.    // Subtree scope. Deciding it means climbing the bus, which is async, so
    // the decisions are chained: signals are scoped and delivered in the order
    // they arrived rather than in whichever order the bus answers.
    queue = queue.then(async () => {
      if (!open) return;
      if (isDefunct && (signal.path === anchor.rootPath || (await rootLeftTheTree()))) {
        if (!open) return;
        open = false;
        detach();
        dropTrailing();
        const known = anchor.known(anchor.busName, anchor.rootPath);
        const change: BackendChange = { id: known?.id ?? deriveId("generic", anchor.busName, anchor.rootPath), role: known?.role ?? "generic", kind: "watchEnded" };
        if (pending !== null) pending.push(change);
        else sink(change);
        return;
      }
      // A defunct descendant is an ordinary change inside the subtree and
      // falls through to the membership climb like any other.
      const membership = await withinSubtree(signal.path);
      if (!open || membership === "outside") return;
      if (membership === "unknown") {
        // Coverage is degraded: something in this application changed and the
        // bus would not say whether it hangs under the watched root (parent
        // unreadable, climb exhausted, cycle). Silence here would let the
        // caller believe the stream is complete; forwarding the descendant
        // would name an element the walk never proved is in scope. The
        // root is the one element this watch is authorized to speak for, so
        // the change is reported THERE: content-free, "look again", under the
        // same backstop as any other change so a flood of unknowns is one
        // nudge per window (CC-08, plan §11).
        const root = anchor.known(anchor.busName, anchor.rootPath);
        deliver({ id: root?.id ?? deriveId("generic", anchor.busName, anchor.rootPath), role: root?.role ?? "generic", kind: "changed" });
        return;
      }
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
    open = false;
    detach();
    pending = null;
    dropTrailing();
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
      dropTrailing();
    },
  };
}

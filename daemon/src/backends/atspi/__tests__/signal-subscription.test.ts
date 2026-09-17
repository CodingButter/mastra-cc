import { describe, expect, it } from "vitest";
import { type BackendChange, DeafWatchError, UnknownSubscriptionError } from "../../../backend.js";
import { AtspiBackend } from "../index.js";
import { replayChannel } from "../../replay/index.js";
import { deriveId } from "../identity.js";
import {
  type AtspiWatchAnchor,
  type IncomingSignal,
  openSignalStream,
  PROBE_PATH,
  type SignalBusOps,
} from "../signal-stream.js";

// The accessibility stream, honestly scoped (Phase 4, ADR-0039).
//
// The route subscribes to Object.StateChanged - the ONE signal class the M0.5
// spike observed to fire - and proves itself alive with a self-caused probe
// before any watch is returned. These tests drive the stream over a fake bus
// whose messages are shaped exactly like the wire's (sender, path, interface,
// member, body), because the failure mode under test is the silent one: a
// registration that "succeeded" and delivers nothing.

const EVENT_OBJECT = "org.a11y.atspi.Event.Object";
const APP_SENDER = ":1.42";
const APP_ROOT_PATH = "/org/a11y/atspi/accessible/root";
const ROOT_PATH = "/org/a11y/atspi/accessible/2000";
const KNOWN_PATH = "/org/a11y/atspi/accessible/2001";
const DEEP_PATH = "/org/a11y/atspi/accessible/9999";
const OUTSIDE_PATH = "/org/a11y/atspi/accessible/7000";
const KNOWN = { id: "el-aaaaaaaaaaaa", role: "checkbox" as const };

// A tiny tree, because the subtree rule cannot be tested without one. The
// watch anchors on ROOT_PATH. KNOWN_PATH is its child and DEEP_PATH its
// grandchild; OUTSIDE_PATH hangs off the application root beside it. Paths are
// opaque handles on the real bus - none of these strings imply the shape, the
// parent edges below do, exactly as on the wire.
const PARENTS: Record<string, string> = {
  [KNOWN_PATH]: ROOT_PATH,
  [DEEP_PATH]: KNOWN_PATH,
  [ROOT_PATH]: APP_ROOT_PATH,
  [OUTSIDE_PATH]: APP_ROOT_PATH,
};
// On the wire an application root's parent is the registry's desktop, on the
// registry's OWN bus name - which is how a climb learns it has left the
// application without ever reading "no parent". "No parent" is what a detached
// or unreadable object answers, and that is unknown, not outside.
const REGISTRY = { busName: "org.a11y.atspi.Registry", objectPath: "/org/a11y/atspi/accessible/root" };

let parentCalls = 0;

// Objects the test has removed from the tree; attachmentOf answers for them
// the way a live GTK view answers after its window is destroyed.
const detached = new Set<string>();
const anchor: AtspiWatchAnchor = {
  busName: APP_SENDER,
  rootPath: ROOT_PATH,
  attachmentOf: async (_busName, objectPath) => (detached.has(objectPath) ? "detached" : "attached"),
  known: (busName, objectPath) => (busName === APP_SENDER && objectPath === KNOWN_PATH ? KNOWN : undefined),
  parentOf: async (busName, objectPath) => {
    parentCalls += 1;
    if (objectPath === APP_ROOT_PATH) return REGISTRY;
    const parent = PARENTS[objectPath];
    return parent === undefined ? undefined : { busName, objectPath: parent };
  },
};

// A fake bus. `healthy` routes emitted signals back to the connection's own
// listeners - what a real bus does when the match rule took. `deaf` swallows
// them - what a real bus does when it silently did not.
function fakeBus({ deaf = false, deafTo = [] as string[] } = {}) {
  const listeners: Array<(signal: IncomingSignal) => void> = [];
  const calls: Array<{ member: string; body?: unknown[] }> = [];
  const ops: SignalBusOps = {
    async call(exchange) {
      calls.push({ member: exchange.member, body: exchange.body });
      return [];
    },
    emit(msg) {
      if (deaf || deafTo.includes(msg.member)) return;
      queueMicrotask(() => {
        for (const listener of [...listeners]) {
          listener({ sender: ":9.99", path: msg.path, iface: msg.iface, member: msg.member, body: msg.body });
        }
      });
    },
    onSignal(listener) {
      listeners.push(listener);
      return () => {
        const at = listeners.indexOf(listener);
        if (at >= 0) listeners.splice(at, 1);
      };
    },
  };
  return {
    ops,
    calls,
    inject(signal: IncomingSignal) {
      for (const listener of [...listeners]) listener(signal);
    },
  };
}

function stateChanged(sender: string, path: string): IncomingSignal {
  // Shaped like the real thing: AT-SPI StateChanged bodies carry the state
  // name and detail integers. Nothing below reads them - attribution is by
  // sender, never by matching text in a payload.
  return { sender, path, iface: EVENT_OBJECT, member: "StateChanged", body: ["showing", 1, 0] };
}

// Shaped like the real thing: an AT-SPI TextChanged body carries the operation
// detail and THE INSERTED OR DELETED TEXT. Nothing below may read it - the
// event is a pointer, and the client learns the new value by observing again.
function textChanged(sender: string, path: string): IncomingSignal {
  return { sender, path, iface: EVENT_OBJECT, member: "TextChanged", body: ["insert", 0, 22, "SIGNAL TEST 2026-08-28"] };
}

// Scoping a signal means climbing the bus, which is asynchronous. Let the
// chained decisions drain before asking what was delivered.
async function settle() {
  for (let turn = 0; turn < 16; turn += 1) await Promise.resolve();
}

describe("the accessibility stream", () => {
  it("registers both ways on the call seam, for every signal class it claims to watch", async () => {
    const bus = fakeBus();
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, () => undefined, 50);
    expect(bus.calls.map((c) => c.member)).toEqual(["AddMatch", "RegisterEvent", "AddMatch", "RegisterEvent"]);
    expect(String(bus.calls[0].body?.[0])).toContain("Object");
    expect(String(bus.calls[0].body?.[0])).toContain("StateChanged");
    expect(bus.calls[1].body).toEqual(["object:state-changed"]);
    expect(String(bus.calls[2].body?.[0])).toContain("TextChanged");
    expect(bus.calls[3].body).toEqual(["object:text-changed"]);
    await watch.close();
  });

  it("turns a TextChanged into the same content-free pointer, carrying none of the text the signal shipped", async () => {
    // The live gap this closes: editing a document emits text-changed and no
    // state-changed at all, so a watch registered only for state changes was
    // deaf to the one mutation this milestone is about.
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 50);
    bus.inject(textChanged(APP_SENDER, KNOWN_PATH));
    await settle();
    expect(changes).toEqual([{ id: KNOWN.id, role: "checkbox", kind: "changed" }]);
    expect(JSON.stringify(changes)).not.toContain("SIGNAL TEST");
    await watch.close();
  });

  it("refuses a watch that hears state changes but is deaf to text changes", async () => {
    // Half a registration is the silent failure that looks exactly like a calm
    // desktop. Every class proves itself or no watch is handed back.
    const bus = fakeBus({ deafTo: ["TextChanged"] });
    await expect(openSignalStream(bus.ops, KNOWN.id, anchor, () => undefined, 25)).rejects.toBeInstanceOf(DeafWatchError);
  });

  it("turns a StateChanged from the watched application into a changed event under the id the walk answered", async () => {
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 50);
    bus.inject(stateChanged(APP_SENDER, KNOWN_PATH));
    await settle();
    expect(changes).toEqual([{ id: KNOWN.id, role: "checkbox", kind: "changed" }]);
    await watch.close();
  });

  it("reports an element the walk never answered under a derived id with the generic role, never a guess", async () => {
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 50);
    bus.inject(stateChanged(APP_SENDER, "/org/a11y/atspi/accessible/9999"));
    await settle();
    expect(changes).toHaveLength(1);
    expect(changes[0].role).toBe("generic");
    expect(changes[0].id).toMatch(/^el-[0-9a-f]{12}$/);
    expect(changes[0].kind).toBe("changed");
    await watch.close();
  });

  it("produces nothing for a signal from a sender outside the watched application", async () => {
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 50);
    bus.inject(stateChanged(":1.77", KNOWN_PATH));
    await settle();
    expect(changes).toEqual([]);
    await watch.close();
  });

  it("produces nothing for a signal from an application outside the visibility set", async () => {
    // An ungranted application's elements are never answered by the walk
    // (ADR-0036), so no watch can anchor inside it and its bus connection is
    // never any watch's sender scope - its signals die here, at the source.
    // The server re-checks visibility at emission besides
    // (subscription-visibility.test.ts); this pins the earlier of the two.
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 50);
    bus.inject(stateChanged(":1.200", "/org/a11y/atspi/accessible/1"));
    await settle();
    expect(changes).toEqual([]);
    await watch.close();
  });

  it("delivers a descendant's change: the subscription speaks for the whole subtree", async () => {
    // Jamie's rule: a watch on an element covers that element and everything
    // under it. A document's text lives in children; a watch that heard only
    // the exact node subscribed would be deaf to the edit it was opened for.
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 50);
    bus.inject(textChanged(APP_SENDER, DEEP_PATH));
    await settle();
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("changed");
    await watch.close();
  });

  it("delivers a change on the watched root itself", async () => {
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 50);
    bus.inject(stateChanged(APP_SENDER, ROOT_PATH));
    await settle();
    expect(changes).toHaveLength(1);
    await watch.close();
  });

  it("produces nothing for a sibling in the same application but outside the watched subtree", async () => {
    // The half of the rule that costs something: same process, same bus
    // connection, granted application - and still silent, because it is not
    // under the element the caller asked about.
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 50);
    bus.inject(stateChanged(APP_SENDER, OUTSIDE_PATH));
    await settle();
    expect(changes).toEqual([]);
    await watch.close();
  });

  it("rechecks ancestry for each signal rather than retaining stale verdicts", async () => {
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 5);
    parentCalls = 0;
    for (let beat = 0; beat < 4; beat += 1) {
      bus.inject(textChanged(APP_SENDER, DEEP_PATH));
      await settle();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // The 100ms backstop collapses the burst into one pointer, which is the
    // point of the backstop; the ancestry cost is what this test watches.
    expect(changes.length).toBeGreaterThanOrEqual(1);
    // Two fresh edges per signal, including signals collapsed by the backstop.
    expect(parentCalls).toBe(8);
    await watch.close();
  });

  it("does not go silent under sustained change: the backstop emits once per window and once more when it ends", async () => {
    // Typing keeps every gap under the window. Measured from arrival, the
    // window never closed and 417 real keystrokes produced one change and no
    // final state (cc09/load trace). Measured from emission, a sustained
    // stream yields one change per window plus the last one after it stops.
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 5);
    for (let key = 0; key < 12; key += 1) {
      bus.inject(textChanged(APP_SENDER, KNOWN_PATH));
      await settle();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // 12 keys over ~240ms: the first emits at once, then roughly one per
    // 100ms window - never only one, never all twelve.
    expect(changes.length).toBeGreaterThanOrEqual(2);
    expect(changes.length).toBeLessThan(12);
    const during = changes.length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    // The newest collapsed change arrives after the window: the final state
    // is announced even though nothing else happened.
    expect(changes.length).toBe(during + 1);
    await watch.close();
  });

  it("ends the watch when the root itself goes defunct, and says nothing afterwards", async () => {
    // Live GTK (cc08/reparent): a window destroyed with the watched element
    // inside announced itself as StateChanged("defunct", 1) on that object.
    // Before this, the daemon forwarded that as two generic "changed" pointers
    // and still called the watch alive. The root's death is the watch's end.
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 5);
    bus.inject({ sender: APP_SENDER, path: ROOT_PATH, iface: EVENT_OBJECT, member: "StateChanged", body: ["defunct", 1, 0] });
    await settle();
    expect(changes).toEqual([{ id: expect.any(String), role: "generic", kind: "watchEnded" }]);
    bus.inject(textChanged(APP_SENDER, KNOWN_PATH));
    bus.inject({ sender: APP_SENDER, path: ROOT_PATH, iface: EVENT_OBJECT, member: "StateChanged", body: ["defunct", 1, 0] });
    await settle();
    expect(changes).toHaveLength(1);
    await watch.close();
  });

  it("ends the watch when the window around the root goes defunct and the root now hangs nowhere - GTK unparents the view and never says defunct for it", async () => {
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 5);
    detached.add(ROOT_PATH);
    try {
      bus.inject({ sender: APP_SENDER, path: APP_ROOT_PATH, iface: EVENT_OBJECT, member: "StateChanged", body: ["defunct", 1, 0] });
      await settle();
      expect(changes.map((c) => c.kind)).toEqual(["watchEnded"]);
    } finally {
      detached.delete(ROOT_PATH);
    }
    await watch.close();
  });

  it("does not end the watch on another object's defunct while the root still hangs in the tree", async () => {
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 5);
    bus.inject({ sender: APP_SENDER, path: APP_ROOT_PATH, iface: EVENT_OBJECT, member: "StateChanged", body: ["defunct", 1, 0] });
    await settle();
    expect(changes).toEqual([]);
    await watch.close();
  });

  it("does not end the watch when an unrelated element or a descendant goes defunct, or when the root's defunct state clears", async () => {
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 5);
    bus.inject({ sender: APP_SENDER, path: OUTSIDE_PATH, iface: EVENT_OBJECT, member: "StateChanged", body: ["defunct", 1, 0] });
    await settle();
    bus.inject({ sender: APP_SENDER, path: KNOWN_PATH, iface: EVENT_OBJECT, member: "StateChanged", body: ["defunct", 1, 0] });
    await settle();
    // Past the backstop window, so the second ordinary change is not collapsed
    // into the first - this test is about what is NOT a watch ending.
    await new Promise((resolve) => setTimeout(resolve, 120));
    bus.inject({ sender: APP_SENDER, path: ROOT_PATH, iface: EVENT_OBJECT, member: "StateChanged", body: ["defunct", 0, 0] });
    await settle();
    expect(changes).toEqual([{ id: KNOWN.id, role: "checkbox", kind: "changed" }, { id: expect.any(String), role: "generic", kind: "changed" }]);
    await watch.close();
  });

  it("drops a held trailing change when the watch closes first", async () => {
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 5);
    bus.inject(textChanged(APP_SENDER, KNOWN_PATH));
    await settle();
    bus.inject(textChanged(APP_SENDER, KNOWN_PATH));
    await settle();
    expect(changes).toHaveLength(1);
    await watch.close();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(changes).toHaveLength(1);
  });

  it.each([true, false])("rechecks membership after reparenting (initially inside: %s)", async (inside) => {
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    let parent = inside ? ROOT_PATH : APP_ROOT_PATH;
    const watch = await openSignalStream(bus.ops, KNOWN.id, {
      ...anchor,
      parentOf: async (busName, path) => path === KNOWN_PATH ? { busName, objectPath: parent } : path === APP_ROOT_PATH ? REGISTRY : undefined,
    }, (change) => changes.push(change), 50);
    bus.inject(stateChanged(APP_SENDER, KNOWN_PATH));
    await settle();
    expect(changes).toHaveLength(inside ? 1 : 0);
    changes.length = 0;
    parent = inside ? APP_ROOT_PATH : ROOT_PATH;
    await new Promise((resolve) => setTimeout(resolve, 110));
    bus.inject(stateChanged(APP_SENDER, KNOWN_PATH));
    await settle();
    expect(changes).toHaveLength(inside ? 0 : 1);
    await watch.close();
  });

  it("says so at the root when ancestry is unreadable, then names the element once it can be placed", async () => {
    // Degraded coverage is reported, not swallowed (CC-08, plan §11): the one
    // element this watch is authorized to speak for is its root, so an
    // unplaceable change becomes a content-free "changed" THERE. The
    // descendant's identity is not forwarded - the walk never proved it is in
    // scope. Once the parent reads again the element is named as usual.
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    let readable = false;
    const watch = await openSignalStream(bus.ops, KNOWN.id, {
      ...anchor,
      known: (busName, objectPath) => busName === APP_SENDER && objectPath === ROOT_PATH ? { id: "el-rrrrrrrrrrrr", role: "window" } : anchor.known(busName, objectPath),
      parentOf: async (busName) => readable ? { busName, objectPath: ROOT_PATH } : undefined,
    }, (change) => changes.push(change), 50);
    bus.inject(stateChanged(APP_SENDER, KNOWN_PATH));
    await settle();
    expect(changes).toEqual([{ id: "el-rrrrrrrrrrrr", role: "window", kind: "changed" }]);
    readable = true;
    await new Promise((resolve) => setTimeout(resolve, 110));
    bus.inject(stateChanged(APP_SENDER, KNOWN_PATH));
    await settle();
    expect(changes.slice(1)).toEqual([{ id: KNOWN.id, role: KNOWN.role, kind: "changed" }]);
    await watch.close();
  });

  it("collapses a flood of unplaceable changes into one root nudge per backstop window", async () => {
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, {
      ...anchor, parentOf: async () => undefined,
    }, (change) => changes.push(change), 50);
    for (let i = 0; i < 20; i += 1) bus.inject(stateChanged(APP_SENDER, `${KNOWN_PATH}${i}`));
    await settle();
    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe("changed");
    await new Promise((resolve) => setTimeout(resolve, 120));
    // The trailing emission at the window's end, and nothing more.
    expect(changes).toHaveLength(2);
    await watch.close();
  });

  it("does not emit when close occurs during a pending parent read", async () => {
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    let finish!: (parent: { busName: string; objectPath: string }) => void;
    const parent = new Promise<{ busName: string; objectPath: string }>((resolve) => { finish = resolve; });
    const watch = await openSignalStream(bus.ops, KNOWN.id, {
      ...anchor, parentOf: () => parent,
    }, (change) => changes.push(change), 50);
    bus.inject(stateChanged(APP_SENDER, KNOWN_PATH));
    await settle();
    await watch.close();
    finish({ busName: APP_SENDER, objectPath: ROOT_PATH });
    await settle();
    expect(changes).toEqual([]);
  });

  it.each(["cycle", "depth", "throw"])("bounds %s ancestry and processes a later root signal", async (mode) => {
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    let reads = 0;
    const watch = await openSignalStream(bus.ops, KNOWN.id, {
      ...anchor,
      parentOf: async (busName, objectPath) => {
        reads += 1;
        if (mode === "throw") throw new Error("parent temporarily unavailable");
        return { busName, objectPath: mode === "cycle" ? objectPath : `${objectPath}/next` };
      },
    }, (change) => changes.push(change), 50);
    bus.inject(stateChanged(APP_SENDER, KNOWN_PATH));
    for (let turn = 0; turn < 64; turn += 1) await Promise.resolve();
    // Bounded work, and a root-level nudge for the change it could not place;
    // the descendant is not named.
    expect(changes.map((c) => c.id)).toEqual([deriveId("generic", APP_SENDER, ROOT_PATH)]);
    expect(reads).toBe(mode === "depth" ? 24 : 1);
    await new Promise((resolve) => setTimeout(resolve, 110));
    bus.inject(stateChanged(APP_SENDER, ROOT_PATH));
    await settle();
    expect(changes).toHaveLength(2);
    await watch.close();
  });

  it("retires a pending parent read when the stream probe refuses", async () => {
    const bus = fakeBus({ deaf: true });
    const changes: BackendChange[] = [];
    let finish!: (parent: { busName: string; objectPath: string }) => void;
    let entered = false;
    const parent = new Promise<{ busName: string; objectPath: string }>((resolve) => { finish = resolve; });
    const opening = openSignalStream(bus.ops, KNOWN.id, {
      ...anchor, parentOf: () => { entered = true; return parent; },
    }, (change) => changes.push(change), 30);
    const rejection = expect(opening).rejects.toBeInstanceOf(DeafWatchError);
    await settle();
    bus.inject(stateChanged(APP_SENDER, KNOWN_PATH));
    await settle();
    expect(entered).toBe(true);
    await rejection;
    finish({ busName: APP_SENDER, objectPath: ROOT_PATH });
    await settle();
    expect(changes).toEqual([]);
  });

  it("delivers nothing after close", async () => {
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 50);
    await watch.close();
    bus.inject(stateChanged(APP_SENDER, KNOWN_PATH));
    await settle();
    expect(changes).toEqual([]);
  });

  it("refuses a watch whose self-caused probe never arrives, and delivers nothing it heard meanwhile", async () => {
    const bus = fakeBus({ deaf: true });
    const changes: BackendChange[] = [];
    const opening = openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 25);
    // Attach the rejection handler before injecting, so the refusal is
    // observed rather than surfacing as an unhandled rejection.
    const verdict = expect(opening).rejects.toBeInstanceOf(DeafWatchError);
    // A subtree change arriving while the probe is out must not leak out of a
    // watch that is then refused: no watch, no delivery.
    bus.inject(stateChanged(APP_SENDER, KNOWN_PATH));
    await verdict;
    expect(changes).toEqual([]);
  });

  it("is not satisfied by an ambient signal: only the probe it caused counts", async () => {
    // The spike's lesson: "signals arrived" is not evidence of anything. The
    // check must observe the event it deliberately caused - identified by its
    // nonce - because the subscription under test cannot also be the judge.
    const bus = fakeBus({ deaf: true });
    const opening = openSignalStream(bus.ops, KNOWN.id, anchor, () => undefined, 25);
    const verdict = expect(opening).rejects.toBeInstanceOf(DeafWatchError);
    bus.inject(stateChanged(APP_SENDER, KNOWN_PATH));
    bus.inject({ sender: ":9.99", path: PROBE_PATH, iface: EVENT_OBJECT, member: "StateChanged", body: ["wrong-nonce"] });
    await verdict;
  });

  it("issues no subscription id when the route is deaf: the backend holds nothing to end", async () => {
    // Backend-level: the refusal must not leave a half-registered watch
    // behind. The tree is a recording of a real desktop (the gtk-dialog
    // tape); only the watch direction is replaced by a deaf one.
    const channel = replayChannel("gtk-dialog");
    const deafChannel = {
      ...channel,
      async watch(): Promise<never> {
        throw new DeafWatchError("deaf for this test");
      },
    };
    const backend = new AtspiBackend(deafChannel, "all");
    const { elements } = await backend.queryElements({});
    expect(elements.length).toBeGreaterThan(0);
    await expect(backend.subscribeElement(elements[0].id, () => undefined)).rejects.toBeInstanceOf(DeafWatchError);
    // Nothing was issued, so there is nothing to end - by name, not by leak.
    await expect(backend.unsubscribeElement("sub-000001-000000")).rejects.toBeInstanceOf(UnknownSubscriptionError);
    await backend.close();
  });
});

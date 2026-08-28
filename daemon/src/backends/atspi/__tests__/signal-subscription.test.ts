import { describe, expect, it } from "vitest";
import { type BackendChange, DeafWatchError, UnknownSubscriptionError } from "../../../backend.js";
import { AtspiBackend } from "../index.js";
import { replayChannel } from "../../replay/index.js";
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
const KNOWN_PATH = "/org/a11y/atspi/accessible/2001";
const KNOWN = { id: "el-aaaaaaaaaaaa", role: "checkbox" as const };

const anchor: AtspiWatchAnchor = {
  busName: APP_SENDER,
  known: (busName, objectPath) => (busName === APP_SENDER && objectPath === KNOWN_PATH ? KNOWN : undefined),
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
    expect(changes).toEqual([{ id: KNOWN.id, role: "checkbox", kind: "changed" }]);
    await watch.close();
  });

  it("reports an element the walk never answered under a derived id with the generic role, never a guess", async () => {
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 50);
    bus.inject(stateChanged(APP_SENDER, "/org/a11y/atspi/accessible/9999"));
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
    expect(changes).toEqual([]);
    await watch.close();
  });

  it("delivers nothing after close", async () => {
    const bus = fakeBus();
    const changes: BackendChange[] = [];
    const watch = await openSignalStream(bus.ops, KNOWN.id, anchor, (c) => changes.push(c), 50);
    await watch.close();
    bus.inject(stateChanged(APP_SENDER, KNOWN_PATH));
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

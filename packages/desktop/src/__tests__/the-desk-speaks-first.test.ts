import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Attribution, ChangeEvent, ChangeKind } from "@mastra-cc/protocol-types";
import { type Backend, startServer } from "@mastra-cc/daemon";
import type { SendNotificationSignalInput } from "@mastra/core/notifications";
import { MastraCC } from "../mastra.js";
import { changeSummary, DesktopSignals } from "../signals.js";

// THE DESK SPEAKING FIRST.
//
// Two layers, deliberately. The first is the WIRING, which is only true if it
// is true end to end: a real daemon over a real socket pushes a real event
// frame, the transport routes it, and a connected agent is notified without
// the agent having asked. Nothing is stubbed on that path.
//
// The second is the JUDGEMENT this provider applies before it wakes anybody -
// what it drops and what it collapses. Those are driven through a stub client,
// because who caused a change is the DAEMON's decision and is already proved
// in daemon/src/__tests__/attribution.test.ts; making a real daemon emit a
// `self` event here would be re-testing the daemon's rule through six layers
// to test three lines of ours.
//
// `node:net` appears nowhere in this file. Pin B5 scans this directory.

const WATCHED = "el-0123456789ab";

type DaemonServer = Awaited<ReturnType<typeof startServer>>;
const started: DaemonServer[] = [];
const open: MastraCC[] = [];

afterEach(async () => {
  for (const desk of open.splice(0)) await desk.close();
  for (const server of started.splice(0)) await new Promise((r) => server.close(r));
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

/** What the backend seam hands the server for one change. Structural, so this test needs no export from the daemon it is only standing up. */
type Change = { id: string; role: ChangeEvent["role"]; kind: ChangeKind };

/**
 * A backend with one watchable element, whose watches the test can drive and
 * which counts every call the server makes into it - which is every request
 * frame this side sends, since a request is the only thing that reaches here.
 */
function watchableBackend() {
  const sinks = new Set<(change: Change) => void>();
  const calls: string[] = [];
  const refuse = async () => {
    throw new Error("this backend observes only");
  };
  const backend: Backend = {
    name: "watchable",
    queryElements: async () => {
      calls.push("queryElements");
      return { elements: [] };
    },
    attestElement: async () => {
      calls.push("attestElement");
      return {};
    },
    readElementContent: async () => {
      calls.push("readElementContent");
      return { content: { kind: "unavailable", reason: "not-exposed" } };
    },
    listApplications: async () => {
      calls.push("listApplications");
      return { applications: [] };
    },
    openApplication: refuse,
    performElementVerb: refuse,
    setElementValue: refuse,
    revealElement: refuse,
    subscribeElement: async (_id: string, sink: (change: Change) => void) => {
      calls.push("subscribeElement");
      sinks.add(sink);
      return {
        subscriptionId: "sub-test-1",
        application: "test-app",
        close: async () => {
          sinks.delete(sink);
        },
      };
    },
    applicationOfElement: () => undefined,
    unsubscribeElement: async () => undefined,
    close: async () => undefined,
  } as unknown as Backend;
  return {
    backend,
    calls,
    push(change: Change) {
      for (const sink of [...sinks]) sink(change);
    },
  };
}

async function daemonWithAWatchableDesk() {
  const desk = watchableBackend();
  const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-signals-")), "daemon.sock");
  started.push(await startServer({ socketPath, backend: desk.backend }));
  const instance = new MastraCC({ socketPath });
  open.push(instance);
  return { ...desk, instance };
}

/** The smallest thing `notify()` will accept as a connected agent: it records. */
function fakeAgent() {
  const sent: Array<{ notification: SendNotificationSignalInput; options: Record<string, unknown> }> = [];
  const agent = {
    async sendNotificationSignal(notification: SendNotificationSignalInput, options: Record<string, unknown>) {
      sent.push({ notification, options });
    },
  };
  return { agent, sent };
}

function event(overrides: Partial<ChangeEvent> = {}): ChangeEvent {
  return {
    subscriptionId: "sub-1",
    id: WATCHED,
    role: "textbox",
    kind: "changed",
    attribution: "external",
    priority: "high",
    at: 1_754_000_000_000,
    ...overrides,
  };
}

/** A provider on a stub client whose change stream the test writes directly. */
function providerOnAStubStream(options?: ConstructorParameters<typeof DesktopSignals>[0]["options"]) {
  const listeners = new Set<(e: ChangeEvent) => void>();
  let closed = false;
  const client = {
    onChangeEvent(listener: (e: ChangeEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
    },
  };
  const provider = new DesktopSignals({
    client: async () => client as never,
    target: { threadId: "thread-1", resourceId: "resource-1" },
    options,
  });
  const { agent, sent } = fakeAgent();
  provider.connect(agent as never);
  return {
    provider,
    sent,
    get listenerCount() {
      return listeners.size;
    },
    get clientClosed() {
      return closed;
    },
    async emit(e: ChangeEvent) {
      for (const listener of [...listeners]) listener(e);
      await settle();
    },
  };
}

describe("a change on the desk reaches the agent without the agent asking", () => {
  it("carries a pushed daemon event into the connected agent's thread", async () => {
    const desk = await daemonWithAWatchableDesk();
    const provider = desk.instance.getSignalProvider({ threadId: "thread-1", resourceId: "resource-1" });
    const { agent, sent } = fakeAgent();
    provider.connect(agent as never);
    await provider.start();

    const client = await desk.instance.client();
    const { subscription } = await client.subscribeElement({ id: WATCHED, priority: "high" });

    // Everything after this point crosses a real socket. Nothing on this side
    // asks for anything: the next frame the client sees is one it did not
    // request.
    desk.push({ id: WATCHED, role: "textbox", kind: "changed" });
    await settle();

    expect(sent).toHaveLength(1);
    expect(sent[0].notification.source).toBe("mastra-cc-desktop");
    expect(sent[0].notification.attributes?.subscriptionId).toBe(subscription?.subscriptionId);
    expect(sent[0].notification.attributes?.attribution).toBe("external");
    expect(sent[0].options.threadId).toBe("thread-1");
    expect(sent[0].options.resourceId).toBe("resource-1");
    // Without this the record is written and the sleeping thread stays asleep.
    expect(sent[0].options.ifIdle).toEqual({ behavior: "wake" });

    provider.stop();
  });

  it("is push, not poll: no timer, no endpoint, and no frame between subscribing and waking", async () => {
    const desk = await daemonWithAWatchableDesk();
    const provider = desk.instance.getSignalProvider({ threadId: "t", resourceId: "r" });
    const { agent, sent } = fakeAgent();
    provider.connect(agent as never);
    await provider.start();

    // A polling provider would be indistinguishable from this one by reading a
    // log, so the assertion is on the mechanism: nothing here can be called on
    // a timer or by an HTTP handler, because neither hook exists.
    expect(provider.pollInterval).toBeUndefined();
    expect(provider.poll).toBeUndefined();
    expect(provider.handleWebhook).toBeUndefined();

    const client = await desk.instance.client();
    await client.subscribeElement({ id: WATCHED, priority: "low" });

    // The count is the proof. A request frame is the only thing this side can
    // write once the handshake is done, and every request frame lands on the
    // backend - so a backend that is not called again is a wire this side did
    // not touch between subscribing and being woken.
    const before = desk.calls.length;
    desk.push({ id: WATCHED, role: "textbox", kind: "changed" });
    await settle();

    expect(sent).toHaveLength(1);
    expect(desk.calls.length - before).toBe(0);
    provider.stop();
  });
});

describe("what the provider says about a change", () => {
  it("carries the subscriber's priority back unread", async () => {
    // Optional on the input type, so it could be dropped silently. The
    // daemon's three are a literal subset of Mastra's four: no translation.
    for (const priority of ["low", "medium", "high"] as const) {
      const stream = providerOnAStubStream();
      await stream.provider.start();
      await stream.emit(event({ priority }));
      expect(stream.sent[0].notification.priority).toBe(priority);
    }
  });

  it("says what changed and never what it says", async () => {
    const stream = providerOnAStubStream();
    await stream.provider.start();
    const changed = event({ role: "button", kind: "appeared", subscriptionId: "sub-9" });
    await stream.emit(changed);

    const summary = stream.sent[0].notification.summary;
    expect(summary).toBe(changeSummary(changed));
    // The format is fixed here so that nobody improvises the element's text
    // into it under deadline. Pointers only: what kind of change, what kind of
    // element, which element, which watch.
    expect(summary).toBe("desktop appeared: button el-0123456789ab (watch sub-9)");
  });

  it("puts attribution in attributes and leaves source as one integration", async () => {
    const stream = providerOnAStubStream();
    await stream.provider.start();
    await stream.emit(event());
    // Splitting `source` by attribution would make one desk look like three to
    // every delivery-policy override written against it.
    expect(stream.sent[0].notification.source).toBe("mastra-cc-desktop");
    expect(stream.sent[0].notification.attributes?.attribution).toBe("external");
  });

  it("sets a dedupe key, because these records persist", async () => {
    const stream = providerOnAStubStream();
    await stream.provider.start();
    await stream.emit(event());
    const { dedupeKey, coalesceKey } = stream.sent[0].notification;
    expect(dedupeKey).toContain("el-0123456789ab");
    expect(coalesceKey).toBe("sub-1");
  });
});

describe("what the provider refuses to wake the agent for", () => {
  it("delivers external, and drops self and unattributed by default", async () => {
    const delivered: Array<Attribution | undefined> = [];
    for (const attribution of ["external", "self", "unattributed"] as const) {
      const stream = providerOnAStubStream();
      await stream.provider.start();
      await stream.emit(event({ attribution }));
      if (stream.sent.length > 0) delivered.push(attribution);
    }
    // `self` is the agent's own edit echoing back; `unattributed` is the
    // daemon saying it cannot tell, which means it MIGHT be that same edit.
    // Waking on either opens a loop that looks like a hung agent, not a bug.
    expect(delivered).toEqual(["external"]);
  });

  it("delivers the dropped kinds when a caller opts in", async () => {
    const stream = providerOnAStubStream({ deliver: ["external", "self"] });
    await stream.provider.start();
    await stream.emit(event({ attribution: "self" }));
    expect(stream.sent).toHaveLength(1);
  });

  it("wakes once for a burst of the same change", async () => {
    const stream = providerOnAStubStream({ dedupeWindowMs: 1000 });
    await stream.provider.start();
    for (let i = 0; i < 5; i++) await stream.emit(event({ at: 1_754_000_000_000 + i }));
    expect(stream.sent).toHaveLength(1);
  });

  it("wakes again once the window has passed", async () => {
    // The other direction matters as much: a throttle that never reopens is
    // an off switch.
    const stream = providerOnAStubStream({ dedupeWindowMs: 1000 });
    await stream.provider.start();
    await stream.emit(event({ at: 1_754_000_000_000 }));
    await stream.emit(event({ at: 1_754_000_001_001 }));
    expect(stream.sent).toHaveLength(2);
  });

  it("throttles per element and per kind, not per subscription", async () => {
    const stream = providerOnAStubStream({ dedupeWindowMs: 1000 });
    await stream.provider.start();
    const kinds: ChangeKind[] = ["changed", "appeared"];
    for (const kind of kinds) await stream.emit(event({ kind }));
    await stream.emit(event({ id: "el-ffffffffffff" }));
    expect(stream.sent).toHaveLength(3);
  });
});

describe("the provider's lifetime is not the connection's", () => {
  it("stops delivering when stopped, and leaves the dial open", async () => {
    const stream = providerOnAStubStream();
    await stream.provider.start();
    expect(stream.listenerCount).toBe(1);

    stream.provider.stop();
    await stream.emit(event());

    expect(stream.sent).toHaveLength(0);
    expect(stream.listenerCount).toBe(0);
    // The connection belongs to the MastraCC instance, which may still be
    // serving tools long after signals are done.
    expect(stream.clientClosed).toBe(false);
  });

  it("attaches one listener however many times it is started", async () => {
    const stream = providerOnAStubStream();
    await stream.provider.start();
    await stream.provider.start();
    expect(stream.listenerCount).toBe(1);
  });
});

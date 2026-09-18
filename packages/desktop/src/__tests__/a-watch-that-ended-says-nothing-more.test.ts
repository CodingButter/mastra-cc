import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChangeEvent, ChangeKind } from "@mastra-cc/protocol-types";
import { type Backend, type LaunchContext, OwnershipTable, startServer } from "@mastra-cc/daemon";
import type { SendNotificationSignalInput } from "@mastra/core/notifications";
import { MastraCC } from "../mastra.js";
import { SIGNAL_WAKE_LIMIT, SignalThrottle } from "../signal-throttle.js";

// CC-04, the part ADR-0099 left open: "unsubscribe may be followed by an extra
// queued notification". Two ways a pointer could wake an agent after its watch
// is over, both closed here:
//
// ONE: the throttle was holding a trailing pointer for the watch when the tool
// layer ended it. The daemon says `ended`, the ledger hears it, and the
// throttle forgets everything pending for that subscription - except the
// watch's own `watchEnded`, which is the one thing the agent is still owed.
//
// TWO: a pointer the daemon wrote just before it answered the unsubscribe.
// The wire is ordered, so it lands BEFORE the answer - inside the gap, held -
// and the answer's `forget` is what drops it. After the answer the daemon's
// book writes nothing for that watch, so there is no third way.
//
// Driven through a REAL daemon on a socket, with the real tool layer ending
// the watch, so the ordering under test is the wire's and not a fixture's.

const WATCHED = "el-0123456789ab";
type Change = { id: string; role: ChangeEvent["role"]; kind: ChangeKind };

type DaemonServer = Awaited<ReturnType<typeof startServer>>;
const started: DaemonServer[] = [];
const open: MastraCC[] = [];
afterEach(async () => {
  for (const desk of open.splice(0)) await desk.close();
  for (const server of started.splice(0)) await new Promise((r) => server.close(r));
});
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function scriptedBackend() {
  const sinks = new Map<string, (change: Change) => void>();
  let minted = 0;
  const refuse = async () => { throw new Error("not in this fixture"); };
  const backend = {
    name: "ending",
    queryElements: async () => ({ elements: [] }),
    attestElement: async () => ({}),
    readElementContent: async () => ({ content: { kind: "unavailable", reason: "not-exposed" } }),
    listApplications: async () => ({ applications: [] }),
    openApplication: refuse, performElementVerb: refuse, setElementValue: refuse, revealElement: refuse, setElementText: refuse,
    setElementCaret: refuse, typeText: refuse, clearElementText: refuse, sendKeyChord: refuse, clickElement: refuse,
    subscribeElement: async (_id: string, sink: (change: Change) => void) => {
      const subscriptionId = `sub-${(++minted).toString(16).padStart(6, "0")}-abcdef`;
      sinks.set(subscriptionId, sink);
      return { subscriptionId, application: "test-app", close: async () => { sinks.delete(subscriptionId); } };
    },
    applicationOfElement: () => "test-app",
    unsubscribeElement: async () => undefined,
    close: async () => undefined,
  } as unknown as Backend;
  return {
    backend,
    /** Push into a specific watch's sink - even one the daemon has ended, to stand in for bytes already on the wire. */
    push(change: Change, into?: (change: Change) => void) { for (const sink of into === undefined ? [...sinks.values()] : [into]) sink(change); },
    sinkOf(subscriptionId: string) { return sinks.get(subscriptionId); },
  };
}

async function daemonWith(desk: ReturnType<typeof scriptedBackend>) {
  const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-cc04-")), "daemon.sock");
  const launch: LaunchContext = { permits: new Set(), allows: new Set(["observe"]), keys: { route: "test" }, catalog: {}, table: new OwnershipTable(), visibility: "all" };
  started.push(await startServer({ socketPath, backend: desk.backend, launch }));
  const instance = new MastraCC({ socketPath });
  open.push(instance);
  return instance;
}

function listeningAgent() {
  const wakes: SendNotificationSignalInput[] = [];
  return { agent: { async sendNotificationSignal(n: SendNotificationSignalInput) { wakes.push(n); } }, wakes };
}

describe("the throttle forgets a watch", () => {
  it("drops pending pointers for that subscription, keeps other watches and its own watchEnded, and never delivers after", async () => {
    const delivered: ChangeEvent[] = [];
    const throttle = new SignalThrottle(50, (event) => delivered.push(event));
    const pointer = (subscriptionId: string, kind: ChangeKind = "changed", id = WATCHED): ChangeEvent => ({ subscriptionId, id, role: "textbox", kind, attribution: "external", priority: "high", at: 0 });
    throttle.push(pointer("a")); throttle.push(pointer("b"));
    expect(delivered).toHaveLength(2);
    // Inside the gap: both trailing.
    throttle.push(pointer("a")); throttle.push(pointer("b"));
    throttle.forget("a");
    await wait(120);
    expect(delivered.slice(2).map((e) => `${e.subscriptionId}:${e.kind}`)).toEqual(["b:changed"]);
    throttle.stop();
  });

  it("keeps the watch's own end even when the wake budget has it pending", async () => {
    const delivered: ChangeEvent[] = [];
    const throttle = new SignalThrottle(1, (event) => delivered.push(event));
    const pointer = (subscriptionId: string, kind: ChangeKind = "changed", id = WATCHED): ChangeEvent => ({ subscriptionId, id, role: "textbox", kind, attribution: "external", priority: "high", at: 0 });
    // Spend the per-second wake budget on distinct elements.
    for (let i = 0; i < SIGNAL_WAKE_LIMIT; i++) throttle.push(pointer("a", "changed", `el-${i.toString(16).padStart(12, "0")}`));
    expect(delivered).toHaveLength(SIGNAL_WAKE_LIMIT);
    // Now a change and the end both wait for the next window.
    throttle.push(pointer("a")); throttle.push(pointer("a", "watchEnded"));
    throttle.forget("a");
    await wait(1100);
    expect(delivered.slice(SIGNAL_WAKE_LIMIT).map((e) => e.kind)).toEqual(["watchEnded"]);
    throttle.stop();
  });
});

describe("through a real daemon and the real tool layer", () => {
  it("a trailing pointer held when the tool ends the watch is not delivered, and a pointer that lands afterwards does not wake", async () => {
    const desk = scriptedBackend();
    const instance = await daemonWith(desk);
    const tools = instance.getTools();
    const provider = instance.getSignalProvider({ threadId: "t", resourceId: "r" }, { deliver: ["external", "unattributed"], dedupeWindowMs: 200 });
    const { agent, wakes } = listeningAgent();
    provider.connect(agent as never);
    await provider.start();
    const subscribed = await tools.subscribeElement.execute!({ id: WATCHED, priority: "high" }, {} as never) as { subscription?: { subscriptionId: string } };
    const subscriptionId = subscribed.subscription!.subscriptionId;
    const sink = desk.sinkOf(subscriptionId)!;

    desk.push({ id: WATCHED, role: "textbox", kind: "changed" });
    await wait(50);
    expect(wakes).toHaveLength(1);
    // Inside the dedupe gap: this one is held for trailing delivery.
    desk.push({ id: WATCHED, role: "textbox", kind: "changed" });
    await wait(20);
    expect(wakes).toHaveLength(1);

    // The race itself: a pointer the daemon writes in the same turn the
    // unsubscribe goes out. It is on the wire before the answer.
    desk.push({ id: WATCHED, role: "textbox", kind: "changed" });
    const ended = await tools.unsubscribeElement.execute!({ subscriptionId }, {} as never) as { ended?: boolean };
    expect(ended.ended).toBe(true);
    expect(instance.observations.watchEnded(subscriptionId)).toBe(true);
    // And bytes pushed at the backend after the end: the daemon's book has
    // no entry for the watch and writes nothing.
    desk.push({ id: WATCHED, role: "textbox", kind: "changed" }, sink);
    await wait(400);
    expect(wakes).toHaveLength(1);
    provider.stop();
  });

  it("a watch the daemon ends itself delivers watchEnded once and nothing after it, and the ledger records the end", async () => {
    const desk = scriptedBackend();
    const instance = await daemonWith(desk);
    const tools = instance.getTools();
    const provider = instance.getSignalProvider({ threadId: "t", resourceId: "r" }, { deliver: ["external", "unattributed"], dedupeWindowMs: 200 });
    const { agent, wakes } = listeningAgent();
    provider.connect(agent as never);
    await provider.start();
    const subscribed = await tools.subscribeElement.execute!({ id: WATCHED, priority: "high" }, {} as never) as { subscription?: { subscriptionId: string } };
    const subscriptionId = subscribed.subscription!.subscriptionId;
    const sink = desk.sinkOf(subscriptionId)!;

    desk.push({ id: WATCHED, role: "textbox", kind: "changed" });
    await wait(50);
    desk.push({ id: WATCHED, role: "textbox", kind: "changed" }); // held
    desk.push({ id: WATCHED, role: "textbox", kind: "watchEnded" });
    await wait(400);
    expect(wakes.map((w) => w.kind)).toEqual(["desktop.changed", "desktop.watchEnded"]);
    expect(instance.observations.watchEnded(subscriptionId)).toBe(true);
    // Late bytes for an ended watch, and a second end: neither is a wake.
    desk.push({ id: WATCHED, role: "textbox", kind: "changed" }, sink);
    await wait(400);
    expect(wakes).toHaveLength(2);
    // A fresh watch on the same element is a new subscription and wakes as before.
    const again = await tools.subscribeElement.execute!({ id: WATCHED, priority: "high" }, {} as never) as { subscription?: { subscriptionId: string } };
    expect(again.subscription!.subscriptionId).not.toBe(subscriptionId);
    desk.push({ id: WATCHED, role: "textbox", kind: "changed" });
    await wait(50);
    expect(wakes).toHaveLength(3);
    provider.stop();
  });
});

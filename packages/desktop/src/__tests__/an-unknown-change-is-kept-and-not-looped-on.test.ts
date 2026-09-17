import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChangeEvent, ChangeKind } from "@mastra-cc/protocol-types";
import { type Backend, type LaunchContext, OwnershipTable, startServer } from "@mastra-cc/daemon";
import type { SendNotificationSignalInput } from "@mastra/core/notifications";
import { MastraCC } from "../mastra.js";
import { DesktopSignals } from "../signals.js";
import { EFFECT_METHODS, ObservationLedger } from "../observations.js";

// CC-06, the second half. The first half made native changes honest: the
// daemon says `unattributed` when it cannot tell who acted, and the provider
// does not wake on that by default. This file is about the two things that
// rule left open.
//
// ONE: an unknown-origin change must not vanish from the task's state. Not
// waking is a policy; not recording is a loss. The ledger holds every pointer
// the connection receives, so a task awaiting exactly that change can see it
// arrive without anyone being woken.
//
// TWO: a caller who opts into unknown-origin wakes must not build a loop. A
// wake causes an edit; the edit echoes back as `unattributed` (the daemon has
// no witness); the echo wakes again. The quiet window after this session's own
// effect is the loop-breaker, and the last test drives the loop through a REAL
// daemon to show it converges - and, with the breaker removed, that it does not.

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

/**
 * A backend whose one editable element ECHOES: every setElementText produces a
 * change pointer a beat later, the way a real toolkit announces the edit it
 * was just asked to make. The daemon has no causal witness for that pointer
 * and will say `unattributed` - which is exactly the input a loop needs.
 */
function echoingBackend(echoAfterMs: number) {
  const sinks = new Set<(change: Change) => void>();
  let edits = 0;
  const refuse = async () => { throw new Error("not in this fixture"); };
  const backend = {
    name: "echoing",
    queryElements: async () => ({ elements: [] }),
    attestElement: async () => ({}),
    readElementContent: async () => ({ content: { kind: "unavailable", reason: "not-exposed" } }),
    listApplications: async () => ({ applications: [] }),
    openApplication: refuse, performElementVerb: refuse, setElementValue: refuse, revealElement: refuse,
    setElementCaret: refuse, typeText: refuse, clearElementText: refuse, sendKeyChord: refuse, clickElement: refuse,
    setElementText: async (params: { id: string; text: string }) => {
      edits += 1;
      setTimeout(() => { for (const sink of [...sinks]) sink({ id: params.id, role: "textbox", kind: "changed" }); }, echoAfterMs);
      return { element: { id: params.id, role: "textbox", name: "field", actions: [], states: [], content: { kind: "text", value: params.text } } };
    },
    subscribeElement: async (_id: string, sink: (change: Change) => void) => {
      sinks.add(sink);
      return { subscriptionId: "sub-echo-1", application: "test-app", close: async () => { sinks.delete(sink); } };
    },
    applicationOfElement: () => "test-app",
    unsubscribeElement: async () => undefined,
    close: async () => undefined,
  } as unknown as Backend;
  return {
    backend,
    get edits() { return edits; },
    push(change: Change) { for (const sink of [...sinks]) sink(change); },
  };
}

async function daemonWith(desk: ReturnType<typeof echoingBackend>) {
  const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-cc06-")), "daemon.sock");
  const launch: LaunchContext = { permits: new Set(), allows: new Set(["edit"]), keys: { route: "test" }, catalog: {}, table: new OwnershipTable(), visibility: "all" };
  started.push(await startServer({ socketPath, backend: desk.backend, launch }));
  const instance = new MastraCC({ socketPath });
  open.push(instance);
  return instance;
}

/**
 * An agent that ACTS on every wake: each notification makes it edit the
 * watched element. The shape of every real agent that reacts to what it sees,
 * and the shape that loops if the wake policy lets an echo wake it.
 */
function reactiveAgent(act: () => Promise<unknown>, cap: number) {
  const wakes: SendNotificationSignalInput[] = [];
  const agent = {
    async sendNotificationSignal(notification: SendNotificationSignalInput) {
      wakes.push(notification);
      if (wakes.length <= cap) await act();
    },
  };
  return { agent, wakes };
}

describe("the ledger keeps what the wake policy declines", () => {
  it("records every attribution, marks stale until observed, and resolves a waiting task without a wake", async () => {
    let now = 0;
    const ledger = new ObservationLedger({ now: () => now });
    const pointer = (attribution: ChangeEvent["attribution"]): ChangeEvent => ({ subscriptionId: "s", id: WATCHED, role: "textbox", kind: "changed", attribution, priority: "medium", at: now });
    expect(ledger.stale(WATCHED)).toBe(false);
    ledger.record(pointer("unattributed"));
    expect(ledger.stale(WATCHED)).toBe(true);
    expect(ledger.entry(WATCHED)?.attribution).toBe("unattributed");
    ledger.observed(WATCHED);
    expect(ledger.stale(WATCHED)).toBe(false);
    // A task that waits is answered by the next pointer, whoever caused it.
    const awaited = ledger.awaitChange(WATCHED);
    now = 5;
    ledger.record(pointer("self"));
    await expect(awaited).resolves.toMatchObject({ id: WATCHED, attribution: "self" });
    // A change the task has not consumed yet IS the awaited change: no second pointer needed.
    await expect(ledger.awaitChange(WATCHED)).resolves.toMatchObject({ id: WATCHED, attribution: "self" });
    // Abort is the caller's way out; nothing else rejects a wait.
    const controller = new AbortController();
    ledger.observed(WATCHED);
    const pending = ledger.awaitChange(WATCHED, { signal: controller.signal });
    controller.abort(new Error("task over"));
    await expect(pending).rejects.toThrow("task over");
  });

  it("bounds retained entries by evicting the oldest, never by refusing the newest", () => {
    const ledger = new ObservationLedger({ limit: 3 });
    for (let i = 0; i < 5; i += 1) ledger.record({ subscriptionId: "s", id: `el-${i}`, role: "generic", kind: "changed", attribution: "external", priority: "low", at: 0 });
    expect(ledger.stale("el-0")).toBe(false);
    expect(ledger.stale("el-1")).toBe(false);
    expect(ledger.stale("el-2")).toBe(true);
    expect(ledger.stale("el-4")).toBe(true);
  });

  it("quiets only unattributed pointers, only inside the window after one of this session's effects", () => {
    let now = 0;
    const ledger = new ObservationLedger({ now: () => now, quietAfterEffectMs: 100 });
    expect(ledger.inQuietWindow({ attribution: "unattributed" })).toBe(false);
    ledger.noteEffect("queryElements"); // observation: not an effect, opens no window
    expect(ledger.effects).toBe(0);
    expect(ledger.inQuietWindow({ attribution: "unattributed" })).toBe(false);
    ledger.noteEffect("setElementText");
    expect(ledger.effects).toBe(1);
    now = 99;
    expect(ledger.inQuietWindow({ attribution: "unattributed" })).toBe(true);
    expect(ledger.inQuietWindow({ attribution: "external" })).toBe(false);
    expect(ledger.inQuietWindow({ attribution: "self" })).toBe(false);
    now = 100;
    expect(ledger.inQuietWindow({ attribution: "unattributed" })).toBe(false);
  });

  it("names the methods that can change the desk, and nothing that only looks", () => {
    for (const method of ["queryElements", "discoverElements", "attestElement", "readElementContent", "subscribeElement", "unsubscribeElement", "listApplications", "describeAccessibility", "describeDesktop", "captureElement"] as const) {
      expect(EFFECT_METHODS.has(method), method).toBe(false);
    }
    for (const method of ["setElementText", "typeText", "clickElement", "sendKeyChord", "activateElement", "submitElement", "openApplication", "restartApplication"] as const) {
      expect(EFFECT_METHODS.has(method), method).toBe(true);
    }
  });
});

describe("through a real daemon: kept for the task, not looped on", () => {
  it("an unattributed change reaches the task's ledger and resolves its wait while the default policy wakes nobody", async () => {
    const desk = echoingBackend(20);
    const instance = await daemonWith(desk);
    const provider = instance.getSignalProvider({ threadId: "t", resourceId: "r" });
    const { agent, wakes } = reactiveAgent(async () => undefined, 0);
    provider.connect(agent as never);
    await provider.start();
    const client = await instance.client();
    await client.subscribeElement({ id: WATCHED, priority: "high" });
    const awaited = instance.observations.awaitChange(WATCHED);
    desk.push({ id: WATCHED, role: "textbox", kind: "changed" });
    await expect(awaited).resolves.toMatchObject({ id: WATCHED, attribution: "unattributed" });
    expect(instance.observations.stale(WATCHED)).toBe(true);
    await wait(60);
    expect(wakes).toHaveLength(0);
    provider.stop();
  });

  it("with unknown-origin wakes opted in, a reactive agent converges: one wake per outside change, its own echoes recorded and not woken on", async () => {
    const desk = echoingBackend(20);
    const instance = await daemonWith(desk);
    const tools = instance.getTools();
    const provider = instance.getSignalProvider({ threadId: "t", resourceId: "r" }, { deliver: ["external", "unattributed"], dedupeWindowMs: 0 });
    const { agent, wakes } = reactiveAgent(() => tools.setElementText.execute!({ id: WATCHED, text: "reacted" }, {} as never), 50);
    provider.connect(agent as never);
    await provider.start();
    const client = await instance.client();
    await client.subscribeElement({ id: WATCHED, priority: "high" });
    // One change from outside. It is `unattributed` too - the daemon cannot
    // tell it from an echo - but it arrives with no effect of ours behind it,
    // so it is outside the quiet window and wakes.
    desk.push({ id: WATCHED, role: "textbox", kind: "changed" });
    await wait(600);
    expect(wakes).toHaveLength(1);
    expect(desk.edits).toBe(1);
    expect(instance.observations.effects).toBe(1);
    // The echo was not lost: the task's ledger saw it.
    expect(instance.observations.stale(WATCHED)).toBe(true);
    provider.stop();
  });

  it("and without the quiet window the same agent loops until something caps it", async () => {
    const desk = echoingBackend(20);
    const instance = await daemonWith(desk);
    const tools = instance.getTools();
    // The provider built without the desk's ledger: what opting in looked
    // like before this change, kept here so the loop is a measured thing.
    const provider = new DesktopSignals({ client: () => instance.client(), target: { threadId: "t", resourceId: "r" }, options: { deliver: ["external", "unattributed"], dedupeWindowMs: 0 } });
    const { agent, wakes } = reactiveAgent(() => tools.setElementText.execute!({ id: WATCHED, text: "reacted" }, {} as never), 8);
    provider.connect(agent as never);
    await provider.start();
    const client = await instance.client();
    await client.subscribeElement({ id: WATCHED, priority: "high" });
    desk.push({ id: WATCHED, role: "textbox", kind: "changed" });
    await wait(600);
    // Eight reactions permitted, nine wakes: every echo woke it again until the cap.
    expect(wakes.length).toBe(9);
    expect(desk.edits).toBe(8);
    provider.stop();
  });
});

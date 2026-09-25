import { refusalText } from "./refusal-text.js";
// CC-06 across a driver transfer. Three things have to hold at once, and the
// one-desktop-driver suite proves none of them because it never subscribes:
//
//  1. A watch belongs to the connection that asked for it. When driver A
//     disconnects mid-effect, A's watch is closed at once - nothing is
//     narrated to a socket that is gone, and nothing is held for it.
//  2. Every backend call is serialised (server.ts `serialised`), so B's
//     subscribe is ANSWERED only after A's still-running effect has settled.
//     The tail of A's effect lands on the desk before B's watch exists, and B
//     hears nothing of it: an event is a pointer to observe again, never a
//     replay, and B's first move on a fresh watch is to look (ADR-0039).
//  3. Once B is the driver and acts, the change reaches B under B's own
//     subscription as `unattributed` - the daemon has no causal witness on
//     the native bus and does not guess, even for the driver's own effect.
//     What B's consumer does with that is the quiet-window policy in
//     packages/desktop; the daemon's part is: deliver it, say unattributed.
import { afterEach, expect, it } from "vitest";
import { createConnection } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_DIGEST, type ChangeEvent } from "@mastra-cc/protocol-types";
import { type Backend, type BackendChange, mintSubscriptionId } from "../backend.js";
import { startServer, type LaunchContext } from "../server.js";
import { OwnershipTable } from "../launch/table.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";
import { observeOnlyEffects } from "./support/observe-only.js";

type Answer = { type: string; id?: number; refusal?: string; result?: { refusal?: string; subscription?: { subscriptionId: string } }; event?: ChangeEvent };
const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });

async function peer(path: string) {
  const messages: Answer[] = []; let buffer = "", id = 0;
  const socket = createConnection(path);
  socket.on("data", data => {
    buffer += data.toString(); let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) { messages.push(JSON.parse(buffer.slice(0, end))); buffer = buffer.slice(end + 1); }
  });
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  const close = () => socket.destroy();
  cleanup.push(close);
  async function wait(predicate: (answer: Answer) => boolean) {
    const deadline = Date.now() + 1500;
    while (!messages.some(predicate)) { if (Date.now() >= deadline) throw Error("response deadline"); await new Promise(resolve => setTimeout(resolve, 5)); }
    return messages.find(predicate)!;
  }
  socket.write(JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST }) + "\n"); await wait(x => x.type === "hello");
  return {
    close, messages,
    events: () => messages.filter(x => x.type === "event").map(x => x.event!),
    async request(method: string, params = {}) { const requestId = ++id; socket.write(JSON.stringify({ type: "request", id: requestId, method, params }) + "\n"); return wait(x => x.id === requestId); },
  };
}

it("closes the old driver's watch on disconnect, answers the new driver's watch only after the old effect settles, and narrates the new driver's own effect unattributed", async () => {
  const sinks = new Map<string, (change: BackendChange) => void>();
  const closed: string[] = [];
  const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
  const entered = deferred(), release = deferred();
  const backend: Backend = {
    ...observeOnlyEffects, name: "transfer-fixture", applicationOfElement: () => "test-app",
    queryElements: async () => ({ elements: [] }), attestElement: async () => ({}),
    readElementContent: async () => ({ content: { kind: "unavailable", reason: "not-exposed" } }),
    subscribeElement: async (_id, sink) => {
      const subscriptionId = mintSubscriptionId();
      sinks.set(subscriptionId, sink);
      return { subscriptionId, application: "test-app", close: async () => { closed.push(subscriptionId); sinks.delete(subscriptionId); } };
    },
    unsubscribeElement: async () => {}, close: async () => {},
    focusedElement: async () => undefined,
    typeText: async params => {
      entered.resolve();
      await release.promise;
      // The effect lands: every live watch on the element hears it. This is
      // the desk speaking, not any connection.
      for (const sink of sinks.values()) sink({ id: params.id, role: "textbox", kind: "changed" });
      return { element: { id: params.id, role: "textbox", name: "field", actions: [], states: [], content: { kind: "text", value: params.text } } };
    },
  };
  const directory = mkdtempSync(join(tmpdir(), "cc-transfer-")); cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const socketPath = join(directory, "daemon.sock");
  const launch: LaunchContext = { permits: new Set(), allows: new Set(["rawInput", "observe"]), keys: { route: "test" }, catalog: DEFANGED_CATALOG, table: new OwnershipTable(), visibility: "all" };
  const server = await startServer({ socketPath, backend, launch }); cleanup.push(() => server.close());

  const a = await peer(socketPath);
  const aWatch = await a.request("subscribeElement", { id: "el-1", priority: "high" });
  expect(refusalText(aWatch)).toBeUndefined();
  const aSubscription = aWatch.result!.subscription!.subscriptionId;
  expect(sinks.has(aSubscription)).toBe(true);

  const running = a.request("typeText", { id: "el-1", text: "tail" }).catch(() => undefined);
  await entered.promise;

  // (1) A leaves mid-effect. Its watch is closed at the backend right away.
  a.close();
  const deadline = Date.now() + 1500;
  while (!closed.includes(aSubscription)) { if (Date.now() >= deadline) throw Error("A's watch was not closed on disconnect"); await new Promise(resolve => setTimeout(resolve, 5)); }
  expect(sinks.has(aSubscription)).toBe(false);

  // (2) B arrives while A's effect is still running. Effects are refused at
  // the ownership gate before any queueing - the desk is still A's until the
  // effect settles. B's watch is queued behind A's effect and is not answered
  // until the effect has landed.
  const b = await peer(socketPath);
  const tooEarly = await b.request("typeText", { id: "el-1", text: "too-early" });
  expect(refusalText(tooEarly)).toContain("another driver");
  const bWatch = b.request("subscribeElement", { id: "el-1", priority: "high" });
  let answered = false;
  void bWatch.then(() => { answered = true; });
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(answered).toBe(false);
  expect(sinks.size).toBe(0);

  // The tail lands on a desk with no watch on it; A's is closed, B's is not yet open.
  release.resolve();
  await running;
  const subscribed = await bWatch;
  expect(refusalText(subscribed)).toBeUndefined();
  const bSubscription = subscribed.result!.subscription!.subscriptionId;
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(b.events()).toEqual([]);
  expect(a.events()).toEqual([]);

  // (3) B is the driver now; its own effect is narrated to its own watch,
  // and the daemon says what it knows: nothing about who caused it.
  const mine = await b.request("typeText", { id: "el-1", text: "mine" });
  expect(refusalText(mine)).toBeUndefined();
  const arrived = Date.now() + 1500;
  while (b.events().length === 0) { if (Date.now() >= arrived) throw Error("B's watch never heard B's own effect"); await new Promise(resolve => setTimeout(resolve, 5)); }
  expect(b.events()).toEqual([expect.objectContaining({ subscriptionId: bSubscription, id: "el-1", kind: "changed", attribution: "unattributed" })]);
  expect(b.events()[0]).not.toHaveProperty("causeId");
});

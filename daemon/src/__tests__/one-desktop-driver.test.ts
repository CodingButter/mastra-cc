import { afterEach, expect, it } from "vitest";
import { createConnection } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import type { Backend } from "../backend.js";
import { startServer, startWebSocketServer, type LaunchContext } from "../server.js";
import { OwnershipTable } from "../launch/table.js";
import { DriverAuthority } from "../driver.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";
import { observeOnlyEffects } from "./support/observe-only.js";

type Answer = { type: string; id?: number; refusal?: string; result?: { refusal?: string } };
const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
async function peer(address: string) {
  const messages: Answer[] = []; let buffer = "", id = 0;
  const receive = (text: string) => {
    buffer += text; let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) { messages.push(JSON.parse(buffer.slice(0, end))); buffer = buffer.slice(end + 1); }
  };
  let write: (text: string) => void, close: () => void;
  if (address.startsWith("ws:")) {
    const socket = new WebSocket(address);
    socket.addEventListener("message", e => receive(String(e.data)));
    await new Promise<void>((resolve, reject) => { socket.addEventListener("open", () => resolve()); socket.addEventListener("error", reject); });
    write = text => socket.send(text); close = () => socket.close();
  } else {
    const socket = createConnection(address); socket.on("data", data => receive(data.toString()));
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    write = text => { socket.write(text); }; close = () => socket.destroy();
  }
  cleanup.push(close);
  async function wait(predicate: (answer: Answer) => boolean) {
    const deadline = Date.now() + 1500;
    while (!messages.some(predicate)) { if (Date.now() >= deadline) throw Error("response deadline"); await new Promise(resolve => setTimeout(resolve, 5)); }
    return messages.find(predicate)!;
  }
  write(JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST }) + "\n"); await wait(x => x.type === "hello");
  return { close, async request(method: string, params = {}) { const requestId = ++id; write(JSON.stringify({ type: "request", id: requestId, method, params }) + "\n"); return wait(x => x.id === requestId); } };
}
async function desktop() {
  const effects: string[] = [];
  const backend: Backend = {
    ...observeOnlyEffects, name: "driver-fixture", applicationOfElement: () => "test-app",
    queryElements: async () => ({ elements: [] }), attestElement: async () => ({}),
    readElementContent: async () => ({ content: { kind: "unavailable", reason: "not-exposed" } }),
    subscribeElement: async () => { throw Error("not used"); }, unsubscribeElement: async () => {}, close: async () => {},
    focusedElement: async () => undefined,
    typeText: async params => { effects.push(params.text); return { element: { id: params.id, role: "textbox", name: "field", actions: [], states: [], content: { kind: "text", value: params.text } } }; },
  };
  const directory = mkdtempSync(join(tmpdir(), "cc-driver-")); cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const socketPath = join(directory, "daemon.sock");
  const launch: LaunchContext = { permits: new Set(), allows: new Set(["rawInput"]), keys: { route: "test" }, catalog: DEFANGED_CATALOG, table: new OwnershipTable(), visibility: "all" };
  const unix = await startServer({ socketPath, backend, launch }); cleanup.push(() => unix.close());
  const websocket = await startWebSocketServer({ port: 0, backend, launch }); cleanup.push(() => websocket.close());
  return { effects, backend, addresses: { unix: socketPath, websocket: `ws://127.0.0.1:${websocket.port}` } };
}
it("retains a disconnected running generation until leave and permanently rejects stale work", () => {
  const authority = new DriverAuthority();
  const old = authority.connect(), next = authority.connect();
  expect(authority.enter(old, true)).toBeUndefined();
  authority.disconnect(old);
  expect(authority.refusal(next, true)).toContain("another driver");
  expect(authority.enter(old, true)).toContain("closed");
  authority.leave(old);
  expect(authority.enter(next, true)).toBeUndefined();
  expect(authority.enter(old, true)).toContain("closed");
  expect(next.generation).toBeGreaterThan(old.generation);
});
const refusal = (answer: Answer) => answer.refusal ?? answer.result?.refusal;
it.each([["unix", "unix"], ["websocket", "websocket"], ["unix", "websocket"], ["websocket", "unix"]] as const)("keeps one driver across %s and %s while permitting observations", async (first, second) => {
  const d = await desktop(), a = await peer(d.addresses[first]), b = await peer(d.addresses[second]);
  expect(refusal(await a.request("typeText", { id: "el-1", text: "first" }))).toBeUndefined();
  expect(refusal(await b.request("typeText", { id: "el-1", text: "second" }))).toContain("another driver");
  expect(refusal(await b.request("queryElements"))).toBeUndefined();
  expect(refusal(await a.request("typeText", { id: "el-1", text: "third" }))).toBeUndefined();
  expect(d.effects).toEqual(["first", "third"]);
  for (const method of ["openApplication", "restartApplication", "acquireAccessibility", "editElement", "activateElement", "submitElement", "setElementValue", "setElementText", "setElementCaret", "revealElement", "sendKeyChord", "clickElement", "clearElementText"]) {
    expect(refusal(await b.request(method))).toContain("another driver");
  }
});
it("discards disconnected queued work and waits for the old operation before transfer", async () => {
  const d = await desktop(), a = await peer(d.addresses.unix), b = await peer(d.addresses.websocket);
  const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
  const entered = deferred(), release = deferred();
  const emit = d.backend.typeText.bind(d.backend);
  d.backend.typeText = async params => { if (params.text === "inflight") { entered.resolve(); await release.promise; } return emit(params); };
  const running = a.request("typeText", { id: "el-1", text: "inflight" }).catch(() => undefined);
  await entered.promise;
  const queued = a.request("typeText", { id: "el-1", text: "stale" }).catch(() => undefined);
  try {
    a.close();
    expect(refusal(await b.request("typeText", { id: "el-1", text: "too-early" }))).toContain("another driver");
  } finally { release.resolve(); }
  await Promise.all([running, queued]);
  expect(refusal(await b.request("queryElements"))).toBeUndefined();
  expect(refusal(await b.request("typeText", { id: "el-1", text: "new" }))).toBeUndefined();
  expect(d.effects).toEqual(["inflight", "new"]);
});

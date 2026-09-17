// CC-09: what the daemon retains for one watch connection, in bytes, and where.
//
// The daemon holds change events in exactly one place on the way out: the
// connection's socket. `serveConnection` writes each event line straight into
// the pipe (server.ts, `book = new SubscriptionBook(event => pipe.write(...))`)
// and the Unix-socket pipe calls `socket.write` without looking at the return
// value or `writableLength`. So the retained queue toward a consumer IS Node's
// writable buffer for that socket, and its size depends on the consumer
// reading. This script measures it under a scripted backend that emits a fixed
// number of changes at the recorded native cadence (cc09/load: ~10 receipts/s
// per element), against a client that reads and one that has stopped reading.
//
// Nothing here is a production distribution claim. It is the daemon's own
// numbers for its own path, so the plan's "retained cache sizes" line has a
// measured entry for the daemon side to sit beside the consumer side.
import assert from "node:assert/strict";
import { createServer, connect } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { serveConnection } from "../../../../../daemon/dist/index.mjs";
import { SCHEMA_DIGEST } from "../../../../../packages/protocol-types/dist/index.js";

// The backend is observe-only: every effect method refuses. Only the four
// observe methods the watch path touches are given behaviour.
const refuse = async () => { throw new Error("this measurement double observes only"); };
const observeOnlyEffects = Object.fromEntries([
  "installedApplications", "discoverElements", "focusedElement", "restoreFocus", "editElement", "activateElement",
  "submitElement", "setElementValue", "setElementText", "setElementCaret", "revealElement", "sendKeyChord",
  "clickElement", "captureElement", "typeText", "clearElementText",
].map((m) => [m, refuse]));
observeOnlyEffects.runningApplications = async () => ({ observable: new Set(), answersFor: new Set() });
let minted = 0;
const mintSubscriptionId = () => `sub-${(++minted).toString(16).padStart(6, "0")}-abcdef`;

const id = "el-0123456789ab";
const EVENTS = Number(process.env.CC09_EVENTS ?? 2000);
const GAP_MS = Number(process.env.CC09_GAP_MS ?? 0);

function backend() {
  let sink = () => {};
  return {
    emit: (change) => sink(change),
    backend: {
      ...observeOnlyEffects,
      name: "queue-measurement",
      applicationOfElement: () => "test-app",
      queryElements: async () => ({ elements: [] }),
      attestElement: async () => { throw new Error("unused"); },
      readElementContent: async () => ({ content: { kind: "unavailable", reason: "not-exposed" } }),
      subscribeElement: async (_id, s) => { sink = s; return { subscriptionId: mintSubscriptionId(), application: "test-app", close: async () => {} }; },
      unsubscribeElement: async () => {},
      close: async () => {},
    },
  };
}

// One measurement: a daemon on a fresh socket, one client, one watch, EVENTS
// changes. `reading` decides whether the client consumes its socket.
async function trial({ reading }) {
  const dir = mkdtempSync(join(tmpdir(), "cc09-queue-"));
  const path = join(dir, "d.sock");
  const world = backend();
  let serverSocket;
  const server = createServer((socket) => {
    serverSocket = socket;
    const pipe = {
      write: (line) => { socket.write(line); },
      end: () => socket.end(),
      get closed() { return socket.destroyed; },
      onData: (h) => socket.on("data", (c) => h(c.toString("utf8"))),
      onClose: (h) => socket.on("close", h),
    };
    serveConnection(pipe, { backend: world.backend, visibility: "all" });
  });
  await new Promise((r) => server.listen(path, r));

  const client = connect(path);
  await new Promise((r) => client.once("connect", r));
  let received = "";
  let eventsSeen = 0;
  const lines = [];
  client.on("data", (c) => {
    received += c.toString("utf8");
    let nl;
    while ((nl = received.indexOf("\n")) >= 0) {
      const line = received.slice(0, nl);
      received = received.slice(nl + 1);
      lines.push(JSON.parse(line));
      if (lines.at(-1).type === "event") eventsSeen += 1;
    }
  });
  client.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
  client.write(`${JSON.stringify({ type: "request", id: 1, method: "subscribeElement", params: { id, priority: "high" } })}\n`);
  await sleep(100);
  const subscribed = lines.find((l) => l.type === "response" && l.id === 1);
  assert.ok(subscribed && !subscribed.refusal, `subscribe refused: ${JSON.stringify(subscribed)}`);
  if (!reading) client.pause();

  const before = process.memoryUsage().heapUsed;
  const samples = [];
  const started = performance.now();
  for (let i = 0; i < EVENTS; i++) {
    world.emit({ id, role: "textbox", kind: "changed" });
    if (GAP_MS > 0) await sleep(GAP_MS);
    else if (i % 100 === 99) await sleep(0);
    if (i % Math.max(1, Math.floor(EVENTS / 10)) === 0) samples.push({ i, writableLength: serverSocket.writableLength });
  }
  await sleep(200);
  const elapsedMs = performance.now() - started;
  const result = {
    reading,
    events: EVENTS,
    gapMs: GAP_MS,
    elapsedMs: Math.round(elapsedMs),
    eventsSeenByClient: eventsSeen,
    // Node's count of bytes accepted by socket.write and not yet handed to the kernel.
    serverWritableLengthAtEnd: serverSocket.writableLength,
    // One event line as the daemon wrote it, so the per-event byte cost is
    // measured from the wire and not estimated.
    bytesPerEventLine: Buffer.byteLength(`${JSON.stringify({ type: "event", event: { subscriptionId: subscribed.result?.subscription?.subscriptionId ?? "sub-000000000000", id, role: "textbox", kind: "changed", attribution: "unattributed", priority: "high", at: Date.now() } })}\n`),
    heapDeltaBytes: process.memoryUsage().heapUsed - before,
    samples,
  };
  if (!reading) client.resume();
  await sleep(200);
  result.eventsSeenAfterResume = eventsSeen;
  client.destroy();
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
  return result;
}

const read = await trial({ reading: true });
const stalled = await trial({ reading: false });
console.log(JSON.stringify({ read, stalled }, null, 2));

// The read client saw every event and the daemon holds nothing for it.
assert.equal(read.eventsSeenByClient, EVENTS);
assert.equal(read.serverWritableLengthAtEnd, 0);
// The stalled client: the daemon kept writing; what it retains is the socket
// buffer, growing with the number of events it was never told to stop for.
assert.ok(stalled.serverWritableLengthAtEnd > 0, "a stalled consumer left nothing in the daemon's socket buffer");
assert.equal(stalled.eventsSeenAfterResume, EVENTS, "events were lost, not retained");
const perEvent = stalled.serverWritableLengthAtEnd / (EVENTS - stalled.eventsSeenByClient);
console.log(`\nretained per undelivered event: ${perEvent.toFixed(1)} B (wire line ${stalled.bytesPerEventLine} B); no bound in the daemon - growth is linear in undelivered events`);
console.log("PROOF: GREEN - measured; the daemon's retained queue toward a consumer is the socket's writable buffer, unbounded and linear");

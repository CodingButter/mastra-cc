// CC-09 / ADR-0106: a consumer that stops reading is not written to.
//
// Same shape as ../daemon-queue/measure.mjs (which is the RED: unbounded
// retention, ~124 B/event, nothing deciding), run against the built daemon
// through its real Unix-socket listener. One watch on two elements, a client
// that pauses after subscribing, EVENTS changes emitted in bursts of 100 per
// turn. Reported: Node's writableLength toward that client at the end, how
// many events it received after resuming, and whether a fresh change after the
// resume was written straight away.
import assert from "node:assert/strict";
import { connect } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { startServer, OwnershipTable, STALLED_CONSUMER_PENDING_BYTES, STALLED_CONSUMER_POINTERS } from "../../../../../daemon/dist/index.mjs";
import { SCHEMA_DIGEST } from "../../../../../packages/protocol-types/dist/index.js";

const refuse = async () => { throw new Error("this demonstration observes only"); };
const observeOnlyEffects = Object.fromEntries([
  "installedApplications", "discoverElements", "focusedElement", "restoreFocus", "editElement", "activateElement",
  "submitElement", "setElementValue", "setElementText", "setElementCaret", "revealElement", "sendKeyChord",
  "clickElement", "captureElement", "typeText", "clearElementText",
].map((m) => [m, refuse]));
observeOnlyEffects.runningApplications = async () => ({ observable: new Set(), answersFor: new Set() });

const root = "el-0123456789ab";
const other = "el-fedcba987654";
const EVENTS = Number(process.env.CC09_EVENTS ?? 8000);

let sink = () => {};
const backend = {
  ...observeOnlyEffects,
  name: "stalled-consumer-demo",
  applicationOfElement: () => "test-app",
  queryElements: async () => ({ elements: [] }),
  attestElement: async () => { throw new Error("unused"); },
  readElementContent: async () => ({ content: { kind: "unavailable", reason: "not-exposed" } }),
  subscribeElement: async (_id, s) => { sink = s; return { subscriptionId: "sub-000001-abcdef", application: "test-app", close: async () => {} }; },
  unsubscribeElement: async () => {},
  close: async () => {},
};

const dir = mkdtempSync(join(tmpdir(), "cc09-stalled-"));
const socketPath = join(dir, "d.sock");
const launch = { permits: new Set(), allows: new Set(["observe"]), keys: { route: "demo" }, catalog: {}, table: new OwnershipTable(), visibility: "all" };
const server = await startServer({ socketPath, backend, launch });
const servedSocket = new Promise((r) => server.once("connection", r));
const client = connect(socketPath);
const served = await servedSocket;
await new Promise((r) => client.once("connect", r));

let received = "";
const lines = [];
client.on("data", (c) => {
  received += c.toString("utf8");
  let nl;
  while ((nl = received.indexOf("\n")) >= 0) { lines.push(JSON.parse(received.slice(0, nl))); received = received.slice(nl + 1); }
});
const events = () => lines.filter((l) => l.type === "event");
client.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
client.write(`${JSON.stringify({ type: "request", id: 1, method: "subscribeElement", params: { id: root, priority: "high" } })}\n`);
await sleep(100);
const subscribed = lines.find((l) => l.type === "response" && l.id === 1);
assert.ok(subscribed && !subscribed.refusal, `subscribe refused: ${JSON.stringify(subscribed)}`);

client.pause();
const samples = [];
for (let i = 0; i < EVENTS; i++) {
  sink({ id: i % 2 === 0 ? root : other, role: "textbox", kind: "changed" });
  if (i % 100 === 99) await sleep(0);
  if (i % Math.floor(EVENTS / 8) === 0) samples.push({ i, writableLength: served.writableLength });
}
await sleep(100);
const retainedAtEnd = served.writableLength;
const seenWhilePaused = events().length;

client.resume();
const resumedAt = Date.now();
while (served.writableLength > 0 && Date.now() - resumedAt < 5000) await sleep(10);
await sleep(100);
const afterResume = events();
const heldDelivered = afterResume.slice(-2).map((l) => l.event.id).sort();

sink({ id: root, role: "textbox", kind: "changed" });
await sleep(100);
const freshWrittenAtOnce = events().length === afterResume.length + 1;

const result = {
  decision: "ADR-0106",
  bound: { pendingBytes: STALLED_CONSUMER_PENDING_BYTES, pointersPerWatch: STALLED_CONSUMER_POINTERS },
  events: EVENTS,
  bytesIfNothingDecided: `~${Math.round(EVENTS * 124 / 1024)} KB (RED measurement, ../daemon-queue/, ~124 B/event unbounded)`,
  retainedAtEnd,
  samples,
  seenWhilePaused,
  eventsAfterResume: afterResume.length,
  heldDelivered,
  freshWrittenAtOnce,
};
console.log(JSON.stringify(result, null, 2));

client.destroy(); served.destroy();
await new Promise((r) => server.close(r));
rmSync(dir, { recursive: true, force: true });

assert.equal(seenWhilePaused, 0, "a paused client reads nothing");
assert.ok(retainedAtEnd > 0 && retainedAtEnd < STALLED_CONSUMER_PENDING_BYTES + 512, `retained ${retainedAtEnd} B is not bounded`);
assert.ok(afterResume.length < EVENTS, "the stall was not replayed");
assert.deepEqual(heldDelivered, [root, other].sort(), "the held pointers were delivered on drain");
assert.ok(freshWrittenAtOnce, "delivery resumed after the drain");
console.log("PROOF: GREEN");

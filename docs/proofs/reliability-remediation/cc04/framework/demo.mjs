// CC-04 under the REAL framework: a real `Agent` with the desk's signal
// provider attached, real `LibSQLStore` notification storage with a persist
// policy, a real daemon on a socket, and the real tool layer ending the watch.
// No model call is permitted (fetch is forbidden); what the agent "hears" is
// what lands in the notifications store for its thread.
//
// The race ADR-0099 left open: a pointer inside the dedupe gap is held for
// trailing delivery; the tool ends the watch; does the held pointer still
// become a notification after the watch is over? RED (pre-change build): yes,
// the pending row's coalescedCount goes to 2 after `ended: true`. (A held
// pointer is a REPEAT of one inside the gap; the framework coalesces repeats
// into the pending row, so the count is where the extra wake shows.) GREEN: no row after the end, and a
// daemon-ended watch leaves exactly one `desktop.watchEnded` row and nothing
// after it.
//
//   node demo.mjs <checkout> <mastra-entry-node_modules-file>
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const load = (path) => import(pathToFileURL(join(root, path)));
const r = createRequire(resolve(process.argv[3]));
const { Agent } = r('@mastra/core/agent'), { Mastra } = r('@mastra/core'), { LibSQLStore } = r('@mastra/libsql'), { Memory } = r('@mastra/memory');
const { startServer, OwnershipTable } = await load('daemon/dist/index.mjs');
const { MastraCC } = await load('packages/desktop/dist/mastra.mjs');
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw Error('model/network calls forbidden'); };

const WATCHED = 'el-0123456789ab';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const directory = mkdtempSync(join(tmpdir(), 'cc04-framework-'));

function desk() {
  const sinks = new Map();
  let minted = 0;
  const refuse = async () => { throw new Error('observe only'); };
  return {
    push(change, into) { for (const sink of into ? [into] : [...sinks.values()]) sink(change); },
    sinkOf(id) { return sinks.get(id); },
    backend: {
      name: 'ending', applicationOfElement: () => 'test-app', focusedElement: async () => undefined,
      queryElements: async () => ({ elements: [] }), attestElement: async () => ({}),
      readElementContent: async () => ({ content: { kind: 'unavailable', reason: 'not-exposed' } }),
      listApplications: async () => ({ applications: [] }),
      openApplication: refuse, performElementVerb: refuse, setElementValue: refuse, revealElement: refuse, setElementText: refuse,
      setElementCaret: refuse, typeText: refuse, clearElementText: refuse, sendKeyChord: refuse, clickElement: refuse,
      subscribeElement: async (_id, sink) => { const subscriptionId = `sub-${(++minted).toString(16).padStart(6, '0')}-abcdef`; sinks.set(subscriptionId, sink); return { subscriptionId, application: 'test-app', close: async () => { sinks.delete(subscriptionId); } }; },
      unsubscribeElement: async () => {}, close: async () => {},
    },
  };
}

async function trial(name, run) {
  const world = desk();
  const socketPath = join(directory, `${name}.sock`);
  const server = await startServer({ socketPath, backend: world.backend, launch: { permits: new Set(), catalog: {}, table: new OwnershipTable(), allows: new Set(['observe']), keys: { route: 'proof' }, visibility: 'all' } });
  const instance = new MastraCC({ socketPath });
  const tools = instance.getTools();
  const target = { threadId: `cc04-${name}`, resourceId: 'cc04' };
  const provider = instance.getSignalProvider(target, { deliver: ['external', 'unattributed'], dedupeWindowMs: 200 });
  const store = new LibSQLStore({ id: `cc04-${name}`, url: `file:${directory}/${name}.db` });
  const agent = new Agent({ id: `cc04-${name}`, name: 'cc04', instructions: 'No generation permitted.', model: 'google/gemini-2.5-flash', signals: [provider], memory: new Memory({ storage: store }), notifications: { deliveryPolicy: { decide: () => 'persist' } } });
  const mastra = new Mastra({ agents: { agent }, storage: store });
  await (await agent.getMemory()).createThread(target);
  const domain = await mastra.getStorage().getStore('notifications');
  // Rows for one subscription coalesce (same coalesceKey while pending), so
  // the honest count is coalescedCount, not row count: a second wake for the
  // same watch is `desktop.changed x2`, not a second row.
  const rows = async () => (await domain.listNotifications({ threadId: target.threadId })).map((row) => `${row.kind} x${row.coalescedCount}`).sort();
  await provider.start();
  const call = async (method, params) => { const result = await tools[method].execute(params, {}); assert.ok(!result.refusal, result.refusal); return result; };
  const result = await run({ world, call, rows });
  provider.stop();
  await instance.close();
  await new Promise((r) => server.close(r));
  return result;
}

// ONE: a held pointer when the tool ends the watch.
const toolEnded = await trial('tool-ended', async ({ world, call, rows }) => {
  const { subscription } = await call('subscribeElement', { id: WATCHED, priority: 'high' });
  world.push({ id: WATCHED, role: 'textbox', kind: 'changed' });
  await sleep(60);
  const beforeHold = await rows();
  world.push({ id: WATCHED, role: 'textbox', kind: 'changed' }); // inside the gap: held
  await sleep(20);
  const atEnd = await rows();
  const { ended } = await call('unsubscribeElement', { subscriptionId: subscription.subscriptionId });
  await sleep(600);
  const afterEnd = await rows();
  world.push({ id: WATCHED, role: 'textbox', kind: 'changed' }, world.sinkOf(subscription.subscriptionId)); // the book has no entry
  await sleep(400);
  return { ended, beforeHold, atEnd, afterEnd, afterLateBytes: await rows() };
});

// TWO: the daemon ends the watch itself.
const daemonEnded = await trial('daemon-ended', async ({ world, call, rows }) => {
  const { subscription } = await call('subscribeElement', { id: WATCHED, priority: 'high' });
  world.push({ id: WATCHED, role: 'textbox', kind: 'changed' });
  await sleep(60);
  world.push({ id: WATCHED, role: 'textbox', kind: 'changed' }); // held
  world.push({ id: WATCHED, role: 'textbox', kind: 'watchEnded' });
  await sleep(600);
  const afterEnd = await rows();
  world.push({ id: WATCHED, role: 'textbox', kind: 'changed' }, world.sinkOf(subscription.subscriptionId));
  await sleep(400);
  return { afterEnd, afterLateBytes: await rows() };
});

rmSync(directory, { recursive: true, force: true });
console.log(JSON.stringify({ fetchCalls, toolEnded, daemonEnded }, null, 2));
assert.equal(fetchCalls, 0);
assert.equal(toolEnded.ended, true);
assert.deepEqual(toolEnded.beforeHold, ['desktop.changed x1']);
assert.deepEqual(toolEnded.atEnd, ['desktop.changed x1'], 'the second pointer was held, not delivered');
assert.deepEqual(toolEnded.afterEnd, ['desktop.changed x1'], 'nothing was delivered after the tool ended the watch');
assert.deepEqual(toolEnded.afterLateBytes, ['desktop.changed x1']);
assert.deepEqual(daemonEnded.afterEnd, ['desktop.changed x1', 'desktop.watchEnded x1'], 'the end is delivered once; the held change is not');
assert.deepEqual(daemonEnded.afterLateBytes, ['desktop.changed x1', 'desktop.watchEnded x1']);
console.log('PROOF: GREEN');

// CC-06's second half, against BUILT artifacts: an agent that acts on every
// wake, on a desk that echoes every edit as an unattributed change. With the
// desk's ledger the loop converges; with the provider built bare (what opting
// into unknown-origin wakes meant before) it runs until capped. Both are run
// here and both numbers are printed - the point is the difference.
//
//   node docs/proofs/reliability-remediation/cc06/wake-policy/demo.mjs [checkout]
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2] ?? '.');
const load = (path) => import(pathToFileURL(join(root, path)));
const { startServer, OwnershipTable } = await load('daemon/dist/index.mjs');
const { MastraCC, DesktopSignals } = await load('packages/desktop/dist/mastra.mjs');
const directory = mkdtempSync(join(tmpdir(), 'cc06-wake-'));
const WATCHED = 'el-0123456789ab';
const CAP = 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function echoingDesk() {
  const sinks = new Set();
  let edits = 0;
  const element = (text) => ({ id: WATCHED, role: 'textbox', name: 'field', actions: [], states: [], content: { kind: 'text', value: text } });
  return {
    get edits() { return edits; },
    push() { for (const sink of [...sinks]) sink({ id: WATCHED, role: 'textbox', kind: 'changed' }); },
    backend: {
      name: 'echoing', applicationOfElement: () => 'test-app', focusedElement: async () => undefined,
      queryElements: async () => ({ elements: [element('')] }),
      attestElement: async () => ({}), readElementContent: async () => ({ content: { kind: 'unavailable', reason: 'not-exposed' } }),
      listApplications: async () => ({ applications: [] }),
      subscribeElement: async (_id, sink) => { sinks.add(sink); return { subscriptionId: 'sub-1', application: 'test-app', close: async () => { sinks.delete(sink); } }; },
      unsubscribeElement: async () => {}, close: async () => {},
      setElementText: async ({ text }) => { edits += 1; setTimeout(() => { for (const sink of [...sinks]) sink({ id: WATCHED, role: 'textbox', kind: 'changed' }); }, 20); return { element: element(text) }; },
    },
  };
}

async function trial(name, withLedger) {
  const desk = echoingDesk();
  const socketPath = join(directory, `${name}.sock`);
  const server = await startServer({ socketPath, backend: desk.backend, launch: { permits: new Set(), catalog: {}, table: new OwnershipTable(), allows: new Set(['edit']), keys: { route: 'proof' }, visibility: 'all' } });
  const instance = new MastraCC({ socketPath });
  const tools = instance.getTools();
  const options = { deliver: ['external', 'unattributed'], dedupeWindowMs: 0 };
  const provider = withLedger
    ? instance.getSignalProvider({ threadId: 't', resourceId: 'r' }, options)
    : new DesktopSignals({ client: () => instance.client(), target: { threadId: 't', resourceId: 'r' }, options });
  let wakes = 0;
  provider.connect({ async sendNotificationSignal() { wakes += 1; if (wakes <= CAP) await tools.setElementText.execute({ id: WATCHED, text: `reaction ${wakes}` }, {}); } });
  await provider.start();
  const client = await instance.client();
  await client.subscribeElement({ id: WATCHED, priority: 'high' });
  desk.push(); // one change from outside
  await sleep(800);
  const stale = instance.observations.stale(WATCHED);
  provider.stop();
  await instance.close();
  await new Promise((r) => server.close(r));
  return { name, withLedger, wakes, edits: desk.edits, echoKeptForTask: stale };
}

try {
  const withBreaker = await trial('with-quiet-window', true);
  const without = await trial('without-quiet-window', false);
  console.log(JSON.stringify(withBreaker));
  console.log(JSON.stringify(without));
  assert.equal(withBreaker.wakes, 1, 'one outside change, one wake');
  assert.equal(withBreaker.edits, 1, 'one reaction');
  assert.equal(withBreaker.echoKeptForTask, true, 'the echo is in the ledger, not lost');
  assert.equal(without.wakes, CAP + 1, 'without the breaker every echo wakes again until the cap');
  console.log('PROOF: GREEN - the quiet window after own effect turns a self-triggering wake loop into one wake per outside change, and the echo is kept for the task');
} finally {
  rmSync(directory, { recursive: true, force: true });
}

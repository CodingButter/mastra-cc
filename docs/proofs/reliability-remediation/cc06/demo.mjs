import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2] ?? '.');
const load = path => import(pathToFileURL(join(root, path)));
const { startServer, OwnershipTable } = await load('daemon/dist/index.mjs');
const { connect } = await load('packages/transport/dist/index.mjs');
const { DesktopSignals } = await load('packages/desktop/dist/mastra.mjs');
const directory = mkdtempSync(join(tmpdir(), 'cc06-proof-'));
const sinks = [], servers = [], clients = [], providers = [], events = [[], [], []];
let wakes = 0, subscription = 0;
const element = { id: 'el-0123456789ab', role: 'textbox', name: 'synthetic', actions: [], states: [], content: { kind: 'text', value: 'changed' } };
const push = () => { for (const sink of sinks) sink({ id: element.id, role: 'textbox', kind: 'changed' }); };
const backend = name => ({
  name, applicationOfElement: () => 'test-app', focusedElement: async () => undefined,
  queryElements: async () => ({ elements: [element] }),
  subscribeElement: async (_id, sink) => { sinks.push(sink); return { subscriptionId: `sub-${++subscription}`, application: 'test-app', close: async () => {} }; },
  unsubscribeElement: async () => {},
  typeText: async () => { push(); return { element }; },
});
try {
  // Two independent backends with the same application name; two peers share the first.
  for (let i = 0; i < 2; i++) {
    const socketPath = join(directory, `desktop-${i}.sock`);
    servers.push(await startServer({ socketPath, backend: backend(`desktop-${i}`), launch: { permits: new Set(), catalog: {}, table: new OwnershipTable(), allows: new Set(['rawInput']), keys: { route: 'scripted' }, visibility: 'all' } }));
  }
  for (let i = 0; i < 3; i++) {
    const client = await connect({ socketPath: join(directory, `desktop-${i === 2 ? 1 : 0}.sock`) });
    clients.push(client); client.onChangeEvent(event => events[i].push(event));
    const provider = new DesktopSignals({ client: async () => client, target: { threadId: `t-${i}`, resourceId: 'r' } });
    provider.connect({ sendNotificationSignal: async () => { wakes++; } });
    providers.push(provider); await provider.start();
    await client.subscribeElement({ id: element.id, priority: 'high' });
  }
  const barrier = () => Promise.all(clients.map(client => client.queryElements({})));
  push(); await barrier();
  await clients[0].typeText({ id: element.id, text: 'attempt' }); await barrier();
  push(); await barrier();
  console.log(JSON.stringify({ attributions: events.map(list => list.map(event => event.attribution)), pointers: events.map(list => list.length), causeIds: events.flat().filter(event => event.causeId !== undefined).length, defaultWakeAttempts: wakes }));
  assert.deepEqual(events.map(list => list.length), [3, 3, 3]);
  assert(events.flat().every(event => event.attribution === 'unattributed' && event.causeId === undefined));
  assert.equal(wakes, 0);
  console.log('PROOF: GREEN — raw pointers survive without invented origin or default planning wakes; real sockets, scripted changes');
} catch (error) {
  console.log(`PROOF: RED — ${error.message}`); process.exitCode = 1;
} finally {
  for (const provider of providers) provider.stop();
  for (const client of clients) client.close();
  await Promise.all(servers.map(server => new Promise(done => server.close(done))));
  rmSync(directory, { recursive: true, force: true });
}

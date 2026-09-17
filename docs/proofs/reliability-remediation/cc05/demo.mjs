import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2] ?? '.');
const { startServer, startWebSocketServer, OwnershipTable } = await import(pathToFileURL(join(root, 'daemon/dist/index.mjs')));
const { connect } = await import(pathToFileURL(join(root, 'packages/transport/dist/index.mjs')));
let failures = 0, attempts = 0, unauthorizedEffects = 0;
for (let trial = 0; trial < 12; trial++) {
  const effects = [], directory = mkdtempSync(join(tmpdir(), 'driver-demo-'));
  const backend = {
    name: 'scripted-effect-sink', applicationOfElement: () => 'test-app',
    focusedElement: async () => undefined,
    queryElements: async () => ({ elements: [] }),
    typeText: async p => { effects.push(p.text); return { element: { id: p.id, role: 'textbox', name: 'synthetic', actions: [], states: [], content: { kind: 'text', value: p.text } } }; },
  };
  const launch = { permits: new Set(), allows: new Set(['rawInput']), keys: { route: 'scripted' }, catalog: [], table: new OwnershipTable(), visibility: 'all' };
  const socketPath = join(directory, 'daemon.sock');
  const unix = await startServer({ socketPath, backend, launch });
  const websocket = await startWebSocketServer({ port: 0, backend, launch });
  const addresses = [{ socketPath }, { url: `ws://127.0.0.1:${websocket.port}` }];
  const a = await connect(addresses[trial % 2]), b = await connect(addresses[Math.floor(trial / 2) % 2]);
  try {
    await a.typeText({ id: 'el-1', text: 'owner-first' });
    let rejected = false;
    try { const answer = await b.typeText({ id: 'el-1', text: 'competing' }); rejected = answer.refusal?.includes('another driver') ?? false; }
    catch (error) { rejected = String(error).includes('another driver'); }
    await b.queryElements({});
    await a.typeText({ id: 'el-1', text: 'owner-last' });
    unauthorizedEffects += effects.filter(x => x === 'competing').length;
    attempts++;
    try { assert.equal(rejected, true); assert.deepEqual(effects, ['owner-first', 'owner-last']); } catch { failures++; }
  } finally { a.close(); b.close(); websocket.close(); await new Promise(done => unix.close(done)); rmSync(directory, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ attempts, failures, unauthorizedEffects, surface: 'built daemon and transport; real Unix/WebSocket peers; scripted effect sink' }));
console.log(failures === 0 ? 'PROOF: GREEN — one connection owns effects across both listeners' : 'PROOF: RED — competing connection reached the effect sink');
process.exitCode = failures === 0 ? 0 : 1;

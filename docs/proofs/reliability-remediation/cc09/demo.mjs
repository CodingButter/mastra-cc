import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
const root = resolve(process.argv[2] ?? '.');
const api = await import(pathToFileURL(join(root, 'daemon/dist/index.mjs')));
const tape = api.replayChannel('gtk-dialog');
const backend = new api.AtspiBackend({ call: request => request.member === 'GetExtents' ? Promise.resolve([[10,10,40,30]]) : tape.call(request), close: () => tape.close() }, 'all');
const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();
try {
  const { elements } = await backend.queryElements({});
  assert(elements.length > 0);
  // Eight concurrent public requests still execute through the unchanged serial queue.
  // Pixels come from real Xvfb/xwd; accessible identity and geometry are scripted.
  const started = performance.now();
  const answers = await Promise.all(Array.from({ length: 8 }, (_, id) => api.handleRequest({ type: 'request', id, method: 'captureElement', params: { id: elements[0].id } }, backend)));
  const wallMs = performance.now() - started;
  for (const answer of answers) assert.equal(answer.result?.image?.width, 40);
  assert.equal(typeof api.readCostMetrics, 'function', 'cost counters unavailable');
  const metrics = api.readCostMetrics();
  for (const phase of ['queueWait', 'requestWork', 'captureAcquire', 'captureDecodeCrop', 'captureEncode', 'captureBytes']) {
    assert.equal(metrics[phase].count, 8, phase);
    assert(metrics[phase].total >= 0 && metrics[phase].max >= 0);
  }
  const pngBytes = answers.map(answer => Buffer.from(answer.result.image.data, 'base64').length);
  assert.equal(metrics.captureBytes.total, pngBytes.reduce((sum, size) => sum + size, 0));
  assert.equal(metrics.captureBytes.max, Math.max(...pngBytes));
  assert(metrics.captureBytes.total > 0);
  console.log(JSON.stringify({ fixture: 'eight concurrent 40x30 captures on 200x150 Xvfb', wallMs, eventLoopMaxMs: delay.max / 1e6, metrics }, null, 2));
  console.log('PROOF: GREEN — native capture stages and serial queue costs recorded without content; no latency target claimed');
} catch (error) {
  console.log(`PROOF: RED — ${error.message}`); process.exitCode = 1;
} finally { delay.disable(); await backend.close(); }

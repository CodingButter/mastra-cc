import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { verifyPixels } from './verify-pixels.mjs';
const [rootArg, widthArg, heightArg, pattern, crop, concurrencyArg, samplesArg = '12'] = process.argv.slice(2);
const root = resolve(rootArg);
const width = Number(widthArg), height = Number(heightArg), concurrency = Number(concurrencyArg), samples = Number(samplesArg);
assert([1, 4].includes(concurrency) && samples >= 12 && samples % concurrency === 0);
const { AtspiBackend, replayChannel, startServer, OwnershipTable, readCostMetrics } = await import(pathToFileURL(join(root, 'daemon/dist/index.mjs')));
const { connect } = await import(pathToFileURL(join(root, 'packages/transport/dist/index.mjs')));
const rectangle = crop === 'small' ? [0, 0, 320, 180] : [0, 0, width, height];
const tape = replayChannel('gtk-dialog');
const backend = new AtspiBackend({ call: request => request.member === 'GetExtents' ? Promise.resolve([rectangle]) : tape.call(request), close: () => tape.close() }, 'all');
const directory = mkdtempSync(join(tmpdir(), 'cc09-matrix-'));
const socketPath = join(directory, 'desktop.sock');
const loop = monitorEventLoopDelay({ resolution: 10 });
const expectedRefusal = pattern === 'noise' && crop === 'full' && width * height * 3 > 4 * 1024 * 1024;
let server, client, refused = 0, imageBytes = 0, responseBytes = 0;
const times = [], queryTimes = [];
const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b);
  assert(sorted.length > 0 && sorted.every(value => Number.isFinite(value) && value >= 0));
  return { samples: sorted.length, min: sorted[0], p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) };
};
try {
  const { elements } = await backend.queryElements({});
  assert(elements.length > 0);
  server = await startServer({ socketPath, backend, launch: { permits: new Set(), catalog: {}, table: new OwnershipTable(), visibility: 'all' } });
  client = await connect({ socketPath });
  const capture = async (verify = false) => {
    const start = performance.now();
    const result = await client.captureElement({ id: elements[0].id });
    const elapsed = performance.now() - start;
    responseBytes += Buffer.byteLength(JSON.stringify(result));
    if (expectedRefusal) {
      assert.match(result.refusal ?? '', /encodes to .* bytes/);
      assert.equal(result.image, undefined);
      refused++;
    } else {
      assert.equal(result.refusal, undefined);
      assert.equal(result.image?.width, rectangle[2]);
      assert.equal(result.image?.height, rectangle[3]);
      const png = Buffer.from(result.image.data, 'base64');
      if (verify) verifyPixels(png, pattern);
      const bytes = png.length;
      assert(bytes > (pattern === 'noise' ? rectangle[2] * rectangle[3] * 2 : 500), 'synthetic pattern was not captured');
      imageBytes += bytes;
    }
    return elapsed;
  };
  const coldMs = await capture(true);
  loop.enable();
  await capture(); await capture();
  const started = performance.now();
  for (let at = 0; at < samples; at += concurrency) {
    const batch = Array.from({ length: concurrency }, capture);
    const queryStart = performance.now();
    const query = client.queryElements({}).then(() => queryTimes.push(performance.now() - queryStart));
    times.push(...await Promise.all(batch));
    await query;
  }
  const wallMs = performance.now() - started;
  loop.disable();
  const metrics = readCostMetrics?.();
  if (metrics) {
    const captures = samples + 3, requests = captures + samples / concurrency;
    for (const phase of ['queueWait', 'requestWork']) assert.equal(metrics[phase].count, requests, phase);
    for (const phase of ['captureAcquire', 'captureDecodeCrop', 'captureEncode', 'captureBytes']) assert.equal(metrics[phase].count, captures, phase);
    if (!expectedRefusal) assert.equal(metrics.captureBytes.total, imageBytes);
    else assert(metrics.captureBytes.total > captures * 4 * 1024 * 1024);
  }
  console.log(JSON.stringify({ display: [width, height], pattern, crop, concurrency, coldMs, latencyMs: summarize(times), queuedQueryMs: summarize(queryTimes), wallMs, eventLoopMaxMs: loop.max / 1e6, maxRssKiB: process.resourceUsage().maxRSS, refused, imageBytes, responseJsonBytes: responseBytes, metrics: metrics ?? null }));
} finally {
  loop.disable();
  if (client) await client.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await backend.close();
  rmSync(directory, { recursive: true, force: true });
}

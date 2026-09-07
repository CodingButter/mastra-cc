import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function verifyMatrix(records) {
  const rows = records.filter(row => row.type !== 'metadata');
  assert.equal(rows.length, 24, 'matrix must contain all 24 cases');
  const keys = new Set();
  let missingInstrumentation = false;
  for (const row of rows) {
    const [width, height] = row.display;
    assert(['1280x720', '1920x1080', '3840x2160'].includes(`${width}x${height}`));
    assert(['ui', 'noise'].includes(row.pattern));
    assert(['small', 'full'].includes(row.crop));
    assert([1, 4].includes(row.concurrency));
    const key = `${width}x${height}/${row.pattern}/${row.crop}/${row.concurrency}`;
    assert(!keys.has(key), 'duplicate matrix case'); keys.add(key);
    for (const [name, count] of [['latencyMs', 12], ['queuedQueryMs', 12 / row.concurrency]]) {
      const stats = row[name];
      assert.equal(stats.samples, count);
      const values = [stats.min, stats.p50, stats.p95, stats.max];
      assert(values.every(value => Number.isFinite(value) && value >= 0));
      assert(values.every((value, index) => index === 0 || value >= values[index - 1]));
    }
    for (const name of ['coldMs', 'wallMs', 'eventLoopMaxMs', 'maxRssKiB', 'imageBytes', 'responseJsonBytes']) assert(Number.isFinite(row[name]) && row[name] >= 0);
    const oversized = row.pattern === 'noise' && row.crop === 'full' && width * height * 3 > 4 * 1024 * 1024;
    assert.equal(row.refused, oversized ? 15 : 0);
    assert(oversized ? row.imageBytes === 0 : row.imageBytes > 0);
    if (!row.metrics) { missingInstrumentation = true; continue; }
    assert.equal(Object.keys(row.metrics).length, 6);
    for (const phase of ['queueWait', 'requestWork', 'captureAcquire', 'captureDecodeCrop', 'captureEncode', 'captureBytes']) {
      const entry = row.metrics[phase];
      assert.equal(entry.count, ['queueWait', 'requestWork'].includes(phase) ? 15 + 12 / row.concurrency : 15);
      assert(Number.isFinite(entry.total) && Number.isFinite(entry.max) && entry.max >= 0 && entry.total >= entry.max);
      assert(entry.total <= entry.count * entry.max + 1e-6 * Math.max(1, entry.total));
    }
    if (oversized) assert(row.metrics.captureBytes.total > 15 * 4 * 1024 * 1024);
    else assert.equal(row.metrics.captureBytes.total, row.imageBytes);
  }
  assert(!missingInstrumentation, 'instrumentation missing: all 24 workload cases validated, phase costs unavailable');
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const rows = verifyMatrix(readFileSync(process.argv[2], 'utf8').trim().split('\n').map(line => JSON.parse(line)));
    console.log('display pattern crop concurrency p50_ms p95_ms query_p95_ms loop_max_ms refusals');
    for (const row of rows) console.log([row.display.join('x'), row.pattern, row.crop, row.concurrency, row.latencyMs.p50.toFixed(2), row.latencyMs.p95.toFixed(2), row.queuedQueryMs.p95.toFixed(2), row.eventLoopMaxMs.toFixed(2), row.refused].join(' '));
    console.log('PROOF: GREEN — 24 native workload cases, complete phase counters and expected size refusals; no performance threshold claimed');
  } catch (error) {
    console.log(`PROOF: RED — ${error.message}`); process.exitCode = 1;
  }
}

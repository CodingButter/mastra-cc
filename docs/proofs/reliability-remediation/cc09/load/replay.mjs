// Replays a recorded native trace through the consumer-side throttle at its
// real inter-arrival gaps, and sizes what the throttle retains in heap bytes
// rather than pointers. Run with --expose-gc: every byte figure below is a
// difference between two garbage-collected heap readings, so without gc it
// would measure allocation noise.
//
//   node --expose-gc replay.mjs <trace.jsonl> [gapMs]
//
// The trace's gaps are the distribution; nothing is synthesised except the
// retained-size sweep, which fills the throttle with N distinct keys to find
// bytes per retained entry by difference. One desk, one editor, two recorded
// workloads: representative of that, and not of anything else.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {SignalThrottle, SIGNAL_RETENTION_LIMIT} from '../../../../../packages/desktop/src/signal-throttle.ts';

assert.ok(typeof globalThis.gc === 'function', 'run with --expose-gc');
const tracePath = process.argv[2];
const gapMs = Number(process.argv[3] ?? 250);
const source = new URL('../../../../../packages/desktop/src/signal-throttle.ts', import.meta.url);
const trace = readFileSync(tracePath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const receipts = trace.filter((e) => e.event === 'native-receipt');
const workloads = trace.filter((e) => e.event === 'workload-start').map((e) => e.workload);
assert.ok(receipts.length >= 2, 'a trace with at least two receipts');

const heapNow = () => { globalThis.gc(); globalThis.gc(); return process.memoryUsage().heapUsed; };
const quantile = (v, q) => v.length ? [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * q))] : null;
const event = (key) => ({ subscriptionId: key, id: 'el-0123456789ab', role: 'text', kind: 'changed', attribution: 'external', priority: 'medium', at: performance.now() });

console.log(JSON.stringify({ kind: 'environment', node: process.version, traceSha256: createHash('sha256').update(readFileSync(tracePath)).digest('hex'), throttleSourceSha256: createHash('sha256').update(readFileSync(source)).digest('hex'), workloads, receipts: receipts.length, gapMs }));

// 1. Replay at recorded gaps. The trace is one element on one subscription,
//    so retention is at most one pointer plus overflow; what the replay
//    measures is delivery count and delivery latency under the real rhythm.
{
  const gaps = receipts.slice(1).map((r, i) => r.monotonicMs - receipts[i].monotonicMs);
  let delivered = 0, overflow = 0, peak = 0;
  const latencies = [];
  const before = heapNow();
  const throttle = new SignalThrottle(gapMs, (ev, broad) => { delivered++; if (broad) overflow++; latencies.push(performance.now() - ev.at); });
  const start = performance.now();
  throttle.push(event(receipts[0].subscriptionId));
  for (let i = 0; i < gaps.length; i++) {
    await sleep(gaps[i]);
    throttle.push(event(receipts[i + 1].subscriptionId));
    peak = Math.max(peak, throttle.retainedCount);
  }
  const replayMs = performance.now() - start;
  await sleep(gapMs + 100);
  const heapHeld = heapNow() - before;
  throttle.stop();
  assert.ok(delivered >= 1 && delivered <= receipts.length);
  assert.equal(throttle.retainedCount, 0);
  console.log(JSON.stringify({ kind: 'replay', gapsMs: { p50: quantile(gaps, 0.5), p95: quantile(gaps, 0.95), max: Math.max(...gaps) }, replayMs, pushed: receipts.length, delivered, overflow, peakRetainedPointers: peak, deliveryMs: { p50: quantile(latencies, 0.5), p95: quantile(latencies, 0.95), max: Math.max(...latencies) }, heapDeltaBytesAfterReplay: heapHeld }));
}

// 2. Retained size in bytes. Fill with N distinct keys inside one window so
//    every one is retained, then read the GC'd heap difference. Reported per
//    N and as a least-squares slope: bytes per retained entry. The pointer
//    limit is asserted, not assumed.
{
  const fill = (n) => {
    const before = heapNow();
    const throttle = new SignalThrottle(60_000, () => {});
    for (let i = 0; i < n; i++) throttle.push(event(`sub-${String(i).padStart(6, '0')}-${'x'.repeat(6)}`));
    for (let i = 0; i < n; i++) throttle.push(event(`sub-${String(i).padStart(6, '0')}-${'x'.repeat(6)}`));
    assert.equal(throttle.retainedCount, Math.min(n, SIGNAL_RETENTION_LIMIT) + (n > SIGNAL_RETENTION_LIMIT ? 1 : 0));
    const held = heapNow() - before;
    const retained = throttle.retainedCount;
    throttle.stop();
    assert.equal(throttle.retainedCount, 0);
    return { retained, held };
  };
  // Warm the engine on the largest case first: the first fill also pays for
  // inline caches and hidden classes, which is not retention.
  fill(SIGNAL_RETENTION_LIMIT);
  const rows = [];
  for (const n of [0, 32, 64, 128, 256]) {
    const samples = Array.from({ length: 5 }, () => fill(n));
    rows.push({ retained: samples[0].retained, heapDeltaBytes: Math.min(...samples.map((s) => s.held)), samples: samples.map((s) => s.held) });
  }
  const xs = rows.map((r) => r.retained), ys = rows.map((r) => r.heapDeltaBytes);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const atLimit = rows[rows.length - 1];
  console.log(JSON.stringify({ kind: 'retained-size', rows, bytesPerRetainedEntry: Math.round(slope), heapBytesAtRetentionLimit: atLimit.heapDeltaBytes, retentionLimit: SIGNAL_RETENTION_LIMIT, note: 'minimum of five GC-differenced heap readings per size after a warm-up fill; includes Map entry, key string and pending event object; excludes the ChangeEvent payload a caller may separately retain' }));
}

console.log(JSON.stringify({ verdict: 'GREEN', claim: 'recorded native rhythm replayed through the throttle; retained entries sized in GC-differenced heap bytes at the pointer limit; one desk, two workloads, no production distribution claim' }));

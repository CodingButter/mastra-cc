import { describe, expect, it } from 'vitest';
import { encodePng } from '../../daemon/src/backends/atspi/capture.js';
import { verifyPixels } from '../../docs/proofs/reliability-remediation/cc09/verify-pixels.mjs';
import { verifyMatrix } from '../../docs/proofs/reliability-remediation/cc09/verify-matrix.mjs';

function fixture() {
  return [[1280, 720], [1920, 1080], [3840, 2160]].flatMap(display => ['ui', 'noise'].flatMap(pattern => ['small', 'full'].flatMap(crop => [1, 4].map(concurrency => {
    const oversized = pattern === 'noise' && crop === 'full' && display[0] * display[1] * 3 > 4 * 1024 * 1024;
    const metrics = Object.fromEntries(['queueWait', 'requestWork', 'captureAcquire', 'captureDecodeCrop', 'captureEncode', 'captureBytes'].map(phase => [phase, { count: ['queueWait', 'requestWork'].includes(phase) ? 15 + 12 / concurrency : 15, total: 100, max: 10 }]));
    metrics.captureBytes.total = oversized ? 100000000 : 15000;
    metrics.captureBytes.max = Math.ceil(metrics.captureBytes.total / 15);
    return { display, pattern, crop, concurrency, coldMs: 10, wallMs: 100, eventLoopMaxMs: 2, maxRssKiB: 1000, imageBytes: oversized ? 0 : 15000, responseJsonBytes: 21000, refused: oversized ? 15 : 0, metrics, latencyMs: { samples: 12, min: 1, p50: 2, p95: 3, max: 3 }, queuedQueryMs: { samples: 12 / concurrency, min: 1, p50: 2, p95: 3, max: 3 } };
  }))));
}

describe('native cost matrix evidence validator', () => {
  it('rejects solid PNGs even when their encoded size exceeds the old UI threshold', () => {
    const pixels = Buffer.alloc(1920 * 1080 * 3);
    const blank = encodePng({ width: 1920, height: 1080, pixels });
    expect(blank.length).toBeGreaterThan(500);
    expect(() => verifyPixels(blank, 'ui')).toThrow(/region mismatch/);
    expect(() => verifyPixels(blank, 'noise')).toThrow();
    pixels.set([31, 41, 56], (10 * 1920 + 10) * 3);
    pixels.set([214, 224, 232], (5 * 1920 + 245) * 3);
    expect(() => verifyPixels(encodePng({ width: 1920, height: 1080, pixels }), 'ui')).not.toThrow();
  });
  it('accepts the complete finite matrix including expected oversized refusals', () => expect(verifyMatrix(fixture())).toHaveLength(24));
  it('rejects missing or duplicated workload cases', () => {
    expect(() => verifyMatrix(fixture().slice(1))).toThrow(/24 cases/);
    const rows = fixture(); rows[0] = rows[1];
    expect(() => verifyMatrix(rows)).toThrow(/duplicate/);
  });
  it('rejects missing instrumentation even when the native workload completed', () => {
    const rows = fixture(); rows[0].metrics = null;
    expect(() => verifyMatrix(rows)).toThrow(/instrumentation missing/);
  });
  it('rejects counters that did not see every request or capture', () => {
    for (const phase of ['queueWait', 'requestWork', 'captureAcquire', 'captureDecodeCrop', 'captureEncode', 'captureBytes']) {
      const rows = fixture(); rows[0].metrics[phase].count--;
      expect(() => verifyMatrix(rows)).toThrow();
    }
  });
  it('rejects invalid durations, distributions, byte counts and refusal counts', () => {
    for (const corrupt of [row => row.latencyMs.p95 = NaN, row => row.latencyMs.p50 = 20, row => row.coldMs = -1, row => row.imageBytes++, row => row.refused++]) {
      const rows = fixture(); corrupt(rows[0]);
      expect(() => verifyMatrix(rows)).toThrow();
    }
  });
});

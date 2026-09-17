const phases = ["queueWait", "requestWork", "captureAcquire", "captureDecodeCrop", "captureEncode", "captureBytes"] as const;
type Phase = (typeof phases)[number];
const totals = Object.fromEntries(phases.map((phase) => [phase, { count: 0, total: 0, max: 0 }])) as Record<Phase, { count: number; total: number; max: number }>;

// Process-wide, fixed-cardinality counters. No request, element or content data.
export function recordCost(phase: Phase, value: number): void {
  const entry = totals[phase];
  entry.count += 1;
  entry.total += value;
  entry.max = Math.max(entry.max, value);
}

export function readCostMetrics() {
  return Object.fromEntries(phases.map((phase) => [phase, { ...totals[phase] }]));
}

export function measureCost<T>(phase: Phase, work: () => T): T {
  const start = performance.now();
  try { return work(); } finally { recordCost(phase, performance.now() - start); }
}

export async function measureAsyncCost<T>(phase: Phase, work: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try { return await work(); } finally { recordCost(phase, performance.now() - start); }
}

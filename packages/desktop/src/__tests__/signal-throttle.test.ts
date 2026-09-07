import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChangeEvent } from "@mastra-cc/protocol-types";
import { SignalThrottle, SIGNAL_RETENTION_LIMIT, SIGNAL_WAKE_LIMIT } from "../signal-throttle.js";
const event = (subscriptionId: string): ChangeEvent => ({ subscriptionId, id: "el-0123456789ab", role: "textbox", kind: "changed", attribution: "external", priority: "low", at: 1 });
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
it("retains at most 256 keys and one overflow pointer through 10000 short-lived watches", async () => {
  const deliver = vi.fn(), throttle = new SignalThrottle(1000, deliver);
  for (let i = 0; i < 10000; i++) {
    throttle.push(event(`sub-${i}`));
    expect(throttle.retainedCount).toBeLessThanOrEqual(SIGNAL_RETENTION_LIMIT + 1);
  }
  expect(deliver).toHaveBeenCalledTimes(SIGNAL_WAKE_LIMIT);
  expect(vi.getTimerCount()).toBe(1);
  for (let i = 0; i < 10; i++) {
    const before = deliver.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(deliver.mock.calls.length - before).toBeLessThanOrEqual(SIGNAL_WAKE_LIMIT);
  }
  expect(throttle.retainedCount).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
it("does not starve a quiet pending key behind continuously refreshed hot keys", async () => {
  const deliver = vi.fn(), throttle = new SignalThrottle(1000, deliver);
  for (let i = 0; i < 33; i++) throttle.push(event(`sub-${i}`));
  for (let round = 0; round < 5; round++) {
    await vi.advanceTimersByTimeAsync(round === 0 ? 500 : 1000);
    for (let i = 0; i < 32; i++) throttle.push(event(`sub-${i}`));
  }
  expect(deliver.mock.calls.some(([pointer]) => pointer.subscriptionId === "sub-32")).toBe(true);
});
it("expires quiet entries without further events", async () => {
  const throttle = new SignalThrottle(1000, vi.fn()); throttle.push(event("sub-1"));
  expect(throttle.retainedCount).toBe(1);
  await vi.advanceTimersByTimeAsync(1000); expect(throttle.retainedCount).toBe(0);
});
it.each([250, 1750])("delivers and expires a quiet key at a nondefault %s ms gap", async (gap) => {
  const deliver = vi.fn(), throttle = new SignalThrottle(gap, deliver);
  throttle.push(event("quiet"));
  await vi.advanceTimersByTimeAsync(100); throttle.push(event("quiet"));
  await vi.advanceTimersByTimeAsync(gap - 101); expect(deliver).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(deliver).toHaveBeenCalledTimes(2);
  expect(deliver.mock.calls[1][0].subscriptionId).toBe("quiet");
  await vi.advanceTimersByTimeAsync(Math.max(gap, 1000) - 1);
  expect(throttle.retainedCount).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(throttle.retainedCount).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
it.each([250, 1750])("requires both renewed budget and the %s ms per-key gap", async (gap) => {
  const deliver = vi.fn(), throttle = new SignalThrottle(gap, deliver);
  for (let repeat = 0; repeat < 2; repeat++) {
    for (let key = 0; key < SIGNAL_WAKE_LIMIT; key++) throttle.push(event(`key-${key}`));
  }
  expect(deliver).toHaveBeenCalledTimes(SIGNAL_WAKE_LIMIT);
  await vi.advanceTimersByTimeAsync(Math.max(gap, 1000) - 1);
  expect(deliver).toHaveBeenCalledTimes(SIGNAL_WAKE_LIMIT);
  await vi.advanceTimersByTimeAsync(1);
  expect(deliver).toHaveBeenCalledTimes(SIGNAL_WAKE_LIMIT * 2);
  expect(new Set(deliver.mock.calls.slice(SIGNAL_WAKE_LIMIT).map(([pointer]) => pointer.subscriptionId)).size).toBe(SIGNAL_WAKE_LIMIT);
  await vi.advanceTimersByTimeAsync(Math.max(gap, 1000));
  expect(throttle.retainedCount).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
it("retains no entries with throttling disabled", () => {
  const throttle = new SignalThrottle(0, vi.fn());
  for (let i = 0; i < 1000; i++) throttle.push(event(`sub-${i}`));
  expect(throttle.retainedCount).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
it("stop clears entries and prevents any later delivery", async () => {
  const deliver = vi.fn(), throttle = new SignalThrottle(1000, deliver);
  for (let i = 0; i < 1000; i++) throttle.push(event(`sub-${i}`));
  throttle.stop(); expect(throttle.retainedCount).toBe(0); expect(vi.getTimerCount()).toBe(0);
  const count = deliver.mock.calls.length;
  throttle.push(event("later")); await vi.advanceTimersByTimeAsync(10000);
  expect(deliver).toHaveBeenCalledTimes(count);
});
it("copies only content-free pointers for a trailing wake", async () => {
  const deliver = vi.fn(), throttle = new SignalThrottle(1000, deliver);
  throttle.push(event("sub-1"));
  const extra = Object.assign(event("sub-1"), { text: "PRIVATE-CONTENT" });
  throttle.push(extra); extra.role = "button";
  await vi.advanceTimersByTimeAsync(1000);
  expect(deliver.mock.calls[1][0].role).toBe("textbox");
  expect(JSON.stringify(deliver.mock.calls)).not.toContain("PRIVATE-CONTENT");
});
it.each([NaN, Infinity, -1])("rejects an invalid throttle duration %s", (gap) => {
  expect(() => new SignalThrottle(gap, vi.fn())).toThrow("finite and nonnegative");
});

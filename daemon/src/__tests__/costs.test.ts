import { describe, expect, it, vi } from "vitest";

describe("content-free process cost counters", () => {
  it("instruments public queued requests separately from capture stages", async () => {
    vi.resetModules();
    const { AtspiBackend, replayChannel, handleRequest, readCostMetrics } = await import("../index.js");
    const backend = new AtspiBackend(replayChannel("gtk-dialog"), "all");
    try {
      await Promise.all([1, 2].map((id) => handleRequest({ type: "request", id, method: "queryElements", params: {} }, backend)));
      expect(readCostMetrics().queueWait.count).toBe(2);
      expect(readCostMetrics().requestWork.count).toBe(2);
      expect(readCostMetrics().captureAcquire.count).toBe(0);
    } finally { await backend.close(); }
  });

  it("separates waiting from work while retaining serial execution", async () => {
    vi.resetModules();
    const { AtspiBackend, replayChannel, handleRequest, readCostMetrics } = await import("../index.js");
    const backend = new AtspiBackend(replayChannel("gtk-dialog"), "all");
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    let calls = 0;
    vi.spyOn(backend, "queryElements").mockImplementation(async () => {
      calls += 1;
      if (calls === 1) { started(); await pending; }
      return { elements: [] };
    });
    try {
      const first = handleRequest({ type: "request", id: 1, method: "queryElements", params: {} }, backend);
      await entered;
      now = 10;
      const second = handleRequest({ type: "request", id: 2, method: "queryElements", params: {} }, backend);
      await Promise.resolve();
      expect(calls).toBe(1);
      now = 25;
      release();
      await Promise.all([first, second]);
      expect(readCostMetrics().queueWait).toEqual({ count: 2, total: 15, max: 15 });
      expect(readCostMetrics().requestWork).toEqual({ count: 2, total: 25, max: 25 });
    } finally { release(); clock.mockRestore(); await backend.close(); }
  });

  it("records failed native acquisition and decoding without inventing encoding work", async () => {
    vi.resetModules();
    const { capture } = await import("../backends/atspi/capture.js");
    const { readCostMetrics } = await import("../costs.js");
    await expect(capture(undefined, async () => { throw new Error("unavailable"); })).rejects.toThrow("unavailable");
    await expect(capture(undefined, async () => Buffer.alloc(0))).rejects.toThrow();
    expect(readCostMetrics().captureAcquire.count).toBe(2);
    expect(readCostMetrics().captureDecodeCrop.count).toBe(1);
    expect(readCostMetrics().captureEncode.count).toBe(0);
  });
  it("records monotonic durations and preserves synchronous results and errors", async () => {
    vi.resetModules();
    const { measureCost, readCostMetrics } = await import("../costs.js");
    const clock = vi.spyOn(performance, "now").mockReturnValueOnce(10).mockReturnValueOnce(13).mockReturnValueOnce(20).mockReturnValueOnce(25);
    try {
      expect(measureCost("captureEncode", () => "private-result")).toBe("private-result");
      const error = new Error("private-error");
      expect(() => measureCost("captureEncode", () => { throw error; })).toThrow(error);
      expect(readCostMetrics().captureEncode).toEqual({ count: 2, total: 8, max: 5 });
      expect(JSON.stringify(readCostMetrics())).not.toContain("private");
    } finally { clock.mockRestore(); }
  });

  it("waits for asynchronous settlement and preserves rejection", async () => {
    vi.resetModules();
    const { measureAsyncCost, readCostMetrics } = await import("../costs.js");
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const result = measureAsyncCost("requestWork", () => pending);
    expect(readCostMetrics().requestWork.count).toBe(0);
    finish();
    await result;
    const error = new Error("private-rejection");
    await expect(measureAsyncCost("requestWork", async () => { throw error; })).rejects.toBe(error);
    expect(readCostMetrics().requestWork.count).toBe(2);
  });

  it("keeps a fixed set of counters and returns detached snapshots", async () => {
    vi.resetModules();
    const { recordCost, readCostMetrics } = await import("../costs.js");
    for (let i = 0; i < 10000; i += 1) recordCost("captureBytes", 10);
    const snapshot = readCostMetrics();
    expect(Object.keys(snapshot)).toHaveLength(6);
    expect(snapshot.captureBytes).toEqual({ count: 10000, total: 100000, max: 10 });
    snapshot.captureBytes.count = 0;
    expect(readCostMetrics().captureBytes.count).toBe(10000);
  });
});

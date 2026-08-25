import { describe, expect, it, vi } from "vitest";

import { createSignalScheduler, type SignalBatch } from "../voice/signal-scheduler.js";

describe("the realtime voice signal scheduler", () => {
  it("never interrupts model speech and releases urgent work at the first clean boundary", () => {
    const delivered: SignalBatch[] = [];
    const scheduler = createSignalScheduler({ deliver: (batch) => delivered.push(batch) });

    scheduler.modelSpeechStarted();
    scheduler.enqueue({ id: "blocked", priority: "urgent", detail: "authorization is required" });
    expect(delivered).toEqual([]);

    scheduler.modelSpeechFinished();
    expect(delivered).toEqual([{ delivery: "automatic", signals: [{ id: "blocked", priority: "urgent", detail: "authorization is required" }] }]);
  });

  it("lets urgent work ride the user's barged-in turn instead of interrupting", () => {
    const delivered: SignalBatch[] = [];
    const scheduler = createSignalScheduler({ deliver: (batch) => delivered.push(batch) });

    scheduler.modelSpeechStarted();
    scheduler.enqueue({ id: "failed", priority: "urgent", detail: "the operation failed" });
    scheduler.userTurn();
    scheduler.modelSpeechFinished();

    expect(delivered).toEqual([{ delivery: "user-turn", signals: [{ id: "failed", priority: "urgent", detail: "the operation failed" }] }]);
  });

  it("batches normal signals after silence and keeps low signals for a user turn", () => {
    vi.useFakeTimers();
    const delivered: SignalBatch[] = [];
    const scheduler = createSignalScheduler({ deliver: (batch) => delivered.push(batch), silenceMs: 500 });

    scheduler.enqueue({ id: "one", priority: "normal", detail: "downloaded one file" });
    scheduler.enqueue({ id: "two", priority: "normal", detail: "downloaded two files" });
    scheduler.enqueue({ id: "aside", priority: "low", detail: "cache was already warm" });
    vi.advanceTimersByTime(499);
    expect(delivered).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(delivered).toEqual([{ delivery: "automatic", signals: [
      { id: "one", priority: "normal", detail: "downloaded one file" },
      { id: "two", priority: "normal", detail: "downloaded two files" },
    ] }]);

    scheduler.userTurn();
    expect(delivered.at(-1)).toEqual({ delivery: "user-turn", signals: [{ id: "aside", priority: "low", detail: "cache was already warm" }] });
    vi.useRealTimers();
  });

  it("deduplicates by orchestrator id without reordering the batch", () => {
    vi.useFakeTimers();
    const delivered: SignalBatch[] = [];
    const scheduler = createSignalScheduler({ deliver: (batch) => delivered.push(batch), silenceMs: 1 });

    scheduler.enqueue({ id: "same", priority: "normal", detail: "first truth" });
    scheduler.enqueue({ id: "same", priority: "urgent", detail: "duplicate noise" });
    scheduler.enqueue({ id: "next", priority: "normal", detail: "second truth" });
    vi.runAllTimers();

    expect(delivered).toEqual([{ delivery: "automatic", signals: [
      { id: "same", priority: "normal", detail: "first truth" },
      { id: "next", priority: "normal", detail: "second truth" },
    ] }]);
    vi.useRealTimers();
  });
});

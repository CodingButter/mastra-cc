import { describe, expect, it, vi } from "vitest";

import { admitOpening } from "../voice/admission.js";

const opening = {
  audio: new Int16Array([1, 2, 3]),
  sampleRate: 16_000 as const,
  channels: 1 as const,
  sampleFormat: "s16le" as const,
  startedAt: 1,
  endedAt: 2,
};

describe("provisional opening admission", () => {
  it("opens, queues the complete opening once, and only then attaches the existing microphone", async () => {
    const order: string[] = [];
    const enqueuePcm = vi.fn(async (audio: Int16Array) => {
      order.push("enqueue");
      expect(audio).toBe(opening.audio);
    });
    const startLiveContinuation = vi.fn(() => order.push("continue"));
    const admit = vi.fn(() => order.push("admit"));

    await expect(
      admitOpening({
        opening,
        hub: {
          classifyDirectedness: async () => ({
            type: "directedness_result",
            id: "gate-1",
            verdict: "directed",
            reason: "addressed-mastra",
          }),
          mintVoiceDial: async () => ({
            type: "voice_dial_result",
            id: "dial-1",
            ok: true,
            token: "auth_tokens/one-use",
            model: "gemini-live-test",
          }),
        },
        detector: { admit, discard: vi.fn() },
        provider: { open: async () => { order.push("open"); }, enqueuePcm, startLiveContinuation },
        microphone: { subscribe: () => () => {} },
      }),
    ).resolves.toBe(true);

    expect(order).toEqual(["open", "enqueue", "admit", "continue"]);
    expect(enqueuePcm).toHaveBeenCalledTimes(1);
    expect(startLiveContinuation).toHaveBeenCalledTimes(1);
  });

  it("discards incidental speech before minting or opening a provider session", async () => {
    const discard = vi.fn();
    const mintVoiceDial = vi.fn();
    const open = vi.fn();

    await expect(
      admitOpening({
        opening,
        hub: {
          classifyDirectedness: async () => ({
            type: "directedness_result",
            id: "gate-2",
            verdict: "incidental",
            reason: "addressed-elsewhere",
          }),
          mintVoiceDial,
        },
        detector: { admit: vi.fn(), discard },
        provider: { open, enqueuePcm: vi.fn(), startLiveContinuation: vi.fn() },
        microphone: { subscribe: () => () => {} },
      }),
    ).resolves.toBe(false);

    expect(discard).toHaveBeenCalledWith("addressed-elsewhere");
    expect(mintVoiceDial).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});

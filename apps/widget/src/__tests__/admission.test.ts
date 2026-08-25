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

describe("provisional opening handoff", () => {
  it("opens one realtime admission session, queues the complete opening once, and attaches the existing microphone", async () => {
    const order: string[] = [];
    const enqueuePcm = vi.fn(async (audio: Int16Array) => {
      order.push("enqueue");
      expect(audio).toBe(opening.audio);
    });
    const startLiveContinuation = vi.fn(() => order.push("continue"));

    await expect(
      admitOpening({
        opening,
        hub: {
          mintVoiceDial: async () => ({
            type: "voice_dial_result",
            id: "dial-1",
            ok: true,
            token: "auth_tokens/one-use",
            model: "gemini-live-test",
          }),
        },
        detector: { discard: vi.fn() },
        provider: { open: async () => { order.push("open"); }, enqueuePcm, startLiveContinuation },
        microphone: { subscribe: () => () => {} },
      }),
    ).resolves.toBe(true);

    expect(order).toEqual(["open", "enqueue", "continue"]);
    expect(enqueuePcm).toHaveBeenCalledTimes(1);
    expect(startLiveContinuation).toHaveBeenCalledTimes(1);
  });

  it("fails closed before opening a provider session when no dial capability exists", async () => {
    const discard = vi.fn();
    const open = vi.fn();

    await expect(
      admitOpening({
        opening,
        hub: {
          mintVoiceDial: async () => ({
            type: "voice_dial_result",
            id: "dial-2",
            ok: false,
            status: 409,
            code: "UNCONFIGURED",
            refusal: "voice unavailable",
          }),
        },
        detector: { discard },
        provider: { open, enqueuePcm: vi.fn(), startLiveContinuation: vi.fn() },
        microphone: { subscribe: () => () => {} },
      }),
    ).resolves.toBe(false);

    expect(discard).toHaveBeenCalledWith("UNCONFIGURED");
    expect(open).not.toHaveBeenCalled();
  });
});

import type { DirectednessRequest } from "@mastra-cc/transport";
import { describe, expect, it, vi } from "vitest";

import type { Resolution } from "../models/configure.js";
import { createDirectednessClassifier } from "../voice/directedness.js";

const request: DirectednessRequest = {
  type: "directedness_request",
  id: "opening-1",
  format: { sampleRate: 16_000, channels: 1, sampleFormat: "s16le" },
  audioBase64: Buffer.from(new Int16Array([1, 2, 3]).buffer).toString("base64"),
};

function resolved(send: (body: unknown) => Promise<{ ok: true; body: unknown } | { ok: false; refusal: string }>): Resolution {
  return {
    model: {
      role: "fast",
      provider: "google",
      model: "gemini-fast",
      account: "google",
      send,
    },
  };
}

const base = {
  configuration: { roles: { fast: "google/gemini-fast" as const } },
  credentials: { credentialFor: () => "held-inside-model" },
};

describe("the directedness gate", () => {
  it("asks only whether the opening addresses Mastra and returns the strict verdict", async () => {
    const send = vi.fn(async (_body: unknown) => ({
      ok: true as const,
      body: {
        candidates: [
          { content: { parts: [{ text: '{"verdict":"directed","reason":"addressed-mastra"}' }] } },
        ],
      },
    }));
    const classify = createDirectednessClassifier({ ...base, resolve: () => resolved(send) });

    await expect(classify(request)).resolves.toEqual({
      type: "directedness_result",
      id: "opening-1",
      verdict: "directed",
      reason: "addressed-mastra",
    });
    expect(send).toHaveBeenCalledOnce();
    const body = JSON.stringify(send.mock.calls[0]?.[0]);
    expect(body).toContain("addressing Mastra");
    expect(body).toContain(request.audioBase64);
    expect(body).toContain("Do not identify the speaker, authorize an action, or transcribe the utterance");
  });

  it("fails closed when fast is absent, unsupported, refused, malformed, or timed out", async () => {
    const cases: Array<[string, Resolution, string]> = [
      ["absent", { refusal: "not configured" }, "unconfigured"],
      [
        "unsupported",
        {
          model: {
            role: "fast",
            provider: "openai",
            model: "gpt-fast",
            account: "openai",
            send: vi.fn(),
          },
        },
        "unsupported-provider",
      ],
      ["refused", resolved(async () => ({ ok: false, refusal: "no" })), "provider-refused"],
      ["malformed", resolved(async () => ({ ok: true, body: {} })), "malformed-answer"],
    ];
    for (const [, resolution, reason] of cases) {
      const classify = createDirectednessClassifier({ ...base, resolve: () => resolution });
      await expect(classify(request)).resolves.toMatchObject({ verdict: "uncertain", reason });
    }

    const classify = createDirectednessClassifier({
      ...base,
      resolve: () => resolved(() => new Promise(() => undefined)),
      timeoutMs: 1,
    });
    await expect(classify(request)).resolves.toMatchObject({ verdict: "uncertain", reason: "timeout" });
  });
});

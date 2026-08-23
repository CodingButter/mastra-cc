import { describe, expect, it } from "vitest";

import {
  ENROLMENT_CAPTURE_ADAPTER,
  LIVE_CAPTURE_ADAPTER,
  VOICE_CAPTURE_OPTIONS,
  fingerprintFrames,
  modelInputWindow,
  normalizeCapturedAudio,
  processEnrolmentCapture,
  processLiveCapture,
} from "../index.js";

function pcm(samples: readonly number[]): Buffer {
  const bytes = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => bytes.writeInt16LE(sample, index * 2));
  return bytes;
}

function phrase(prefix = 0, suffix = 0): Buffer {
  const samples = [
    ...Array<number>(prefix).fill(0),
    ...Array.from({ length: 640 }, (_, index) => Math.round(Math.sin(index / 9) * 12_000)),
    ...Array<number>(suffix).fill(0),
  ];
  return pcm(samples);
}

describe("the one voice capture pipeline", () => {
  it("passes one raw buffer through both complete adapters byte-for-byte", () => {
    const raw = phrase(80, 120);
    const enrolment = processEnrolmentCapture(raw, {
      sampleRate: 16_000,
      channels: 1,
      sampleFormat: "s16le",
    });
    const live = processLiveCapture(raw, {
      sampleRate: 16_000,
      channels: 1,
      sampleFormat: "s16le",
    });

    expect(Buffer.from(enrolment.normalized.buffer)).toEqual(Buffer.from(live.normalized.buffer));
    expect(enrolment.parameters).toEqual(live.parameters);
    expect(enrolment.fingerprint).toEqual(live.fingerprint);
  });

  it("makes both production adapters name the same frozen options and implementation", () => {
    expect(Object.isFrozen(VOICE_CAPTURE_OPTIONS)).toBe(true);
    expect(ENROLMENT_CAPTURE_ADAPTER.pipeline).toBe(normalizeCapturedAudio);
    expect(LIVE_CAPTURE_ADAPTER.pipeline).toBe(normalizeCapturedAudio);
    expect(ENROLMENT_CAPTURE_ADAPTER.options).toBe(VOICE_CAPTURE_OPTIONS);
    expect(LIVE_CAPTURE_ADAPTER.options).toBe(VOICE_CAPTURE_OPTIONS);
  });

  it("normalizes stereo input to the shipping mono sample rate deterministically", () => {
    const stereo = pcm([1_000, 3_000, 2_000, 4_000, 3_000, 5_000, 4_000, 6_000]);
    const first = normalizeCapturedAudio(stereo, {
      sampleRate: 32_000,
      channels: 2,
      sampleFormat: "s16le",
    });
    const second = normalizeCapturedAudio(stereo, {
      sampleRate: 32_000,
      channels: 2,
      sampleFormat: "s16le",
    });

    expect([...first]).toEqual([...second]);
    expect([...first]).toEqual([2_000, 4_000]);
  });

  it("constructs deterministic fingerprints from identical normalized frames", () => {
    const normalized = normalizeCapturedAudio(phrase(), {
      sampleRate: 16_000,
      channels: 1,
      sampleFormat: "s16le",
    });

    expect(fingerprintFrames(normalized)).toEqual(fingerprintFrames(normalized));
  });

  it("is invariant to enclosing silence around the same phrase", () => {
    const bare = normalizeCapturedAudio(phrase(), {
      sampleRate: 16_000,
      channels: 1,
      sampleFormat: "s16le",
    });
    const enclosed = normalizeCapturedAudio(phrase(480, 720), {
      sampleRate: 16_000,
      channels: 1,
      sampleFormat: "s16le",
    });

    expect(fingerprintFrames(enclosed)).toEqual(fingerprintFrames(bare));
  });

  it("centers and peak-normalizes the phrase exactly as classifier training did", () => {
    const normalized = normalizeCapturedAudio(phrase(480, 720), {
      sampleRate: 16_000,
      channels: 1,
      sampleFormat: "s16le",
    });
    const window = modelInputWindow(normalized);
    const nonzero = [...window].map(Math.abs).filter((sample) => sample > 0);

    expect(window).toHaveLength(32_000);
    expect(Math.max(...nonzero)).toBeCloseTo(0.95, 4);
    expect(window.findIndex((sample) => sample !== 0)).toBeGreaterThan(15_000);
    const lastNonzero = window.length - 1 - [...window].reverse().findIndex((sample) => sample !== 0);
    expect(lastNonzero).toBeLessThan(17_000);
  });

  it("does not produce a usable fingerprint from silence", () => {
    const normalized = normalizeCapturedAudio(pcm(Array<number>(1_000).fill(0)), {
      sampleRate: 16_000,
      channels: 1,
      sampleFormat: "s16le",
    });

    expect(fingerprintFrames(normalized)).toEqual([]);
  });
});

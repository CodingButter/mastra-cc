import { describe, expect, it } from "vitest";

import {
  LIVE_CAPTURE_ADAPTER,
  VOICE_CAPTURE_OPTIONS,
  modelInputWindow,
  normalizeCapturedAudio,
  overlappingWakeWindows,
  processLiveCapture,
} from "../index.js";
import { microphoneCaptureCommand } from "../node.js";

function pcm(samples: readonly number[]): Buffer {
  const bytes = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => bytes.writeInt16LE(sample, index * 2));
  return bytes;
}

function phrase(prefix = 0, suffix = 0): Buffer {
  return pcm([
    ...Array<number>(prefix).fill(0),
    ...Array.from({ length: 640 }, (_, index) => Math.round(Math.sin(index / 9) * 12_000)),
    ...Array<number>(suffix).fill(0),
  ]);
}

describe("the voice capture pipeline", () => {
  it("uses the frozen normalization options for live capture", () => {
    const raw = phrase(80, 120);
    const live = processLiveCapture(raw, { sampleRate: 16_000, channels: 1, sampleFormat: "s16le" });
    expect(LIVE_CAPTURE_ADAPTER.pipeline).toBe(normalizeCapturedAudio);
    expect(LIVE_CAPTURE_ADAPTER.options).toBe(VOICE_CAPTURE_OPTIONS);
    expect(live.parameters.output).toBe(VOICE_CAPTURE_OPTIONS);
  });

  it("normalizes stereo input to the shipping mono sample rate deterministically", () => {
    const stereo = pcm([1_000, 3_000, 2_000, 4_000, 3_000, 5_000, 4_000, 6_000]);
    const first = normalizeCapturedAudio(stereo, { sampleRate: 32_000, channels: 2, sampleFormat: "s16le" });
    const second = normalizeCapturedAudio(stereo, { sampleRate: 32_000, channels: 2, sampleFormat: "s16le" });
    expect([...first]).toEqual([...second]);
    expect([...first]).toEqual([2_000, 4_000]);
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

  it("scores a four-second capture through five overlapping two-second windows", () => {
    const normalized = Int16Array.from({ length: 64_000 }, (_, index) => index);
    const windows = overlappingWakeWindows(normalized);
    expect(windows).toHaveLength(5);
    expect(windows.map((window) => window.length)).toEqual([32_000, 32_000, 32_000, 32_000, 32_000]);
    expect(windows.map((window) => window[0])).toEqual([0, 8_000, 16_000, 24_000, 32_000]);
  });

  it("keeps a short capture as one model window", () => {
    const normalized = Int16Array.from([1, 2, 3]);
    expect(overlappingWakeWindows(normalized)).toEqual([normalized]);
  });

  it("defines the only production microphone command at the package boundary", () => {
    expect(microphoneCaptureCommand({ device: "hw:0,6", seconds: 2 })).toEqual({
      command: "arecord",
      args: ["--quiet", "--device", "hw:0,6", "--format", "S16_LE", "--channels", "1", "--rate", "16000", "--duration", "2", "--file-type", "raw"],
    });
  });
});

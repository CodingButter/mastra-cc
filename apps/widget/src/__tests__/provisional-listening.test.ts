import { describe, expect, it } from "vitest";

import {
  PROVISIONAL_MAX_SAMPLES,
  PROVISIONAL_PRE_ROLL_SAMPLES,
  createProvisionalListening,
} from "../provisional-listening.js";

function samples(length: number, value: number): Int16Array {
  return Int16Array.from({ length }, () => value);
}

describe("provisional listening", () => {
  it("moves through wake, capture, realtime admission, and conversation without duplicating wake", () => {
    const subject = createProvisionalListening({ now: () => 100 });
    subject.push(samples(40_000, 10));
    expect(subject.wakeDetected(32_000)).toBe(true);
    expect(subject.state()).toBe("capturing-opening");
    expect(subject.wakeDetected(32_000)).toBe(false);
    subject.push(samples(2_000, 20));
    const opening = subject.finishOpening();
    expect(subject.state()).toBe("awaiting-admission");
    expect(opening.audio.length).toBe(PROVISIONAL_PRE_ROLL_SAMPLES + 32_000 + 2_000);
    expect([...opening.audio.slice(0, 3)]).toEqual([10, 10, 10]);
    subject.admit("verdict-1");
    expect(subject.state()).toBe("admitted");
  });

  it("retains wake-adjacent opening samples without restarting capture", () => {
    const subject = createProvisionalListening({ now: () => 100 });
    subject.push(Int16Array.from({ length: 48_000 }, (_, index) => index));
    subject.wakeDetected(32_000);
    subject.push(Int16Array.from([30_001, 30_002, 30_003]));
    const opening = subject.finishOpening();
    expect(opening.audio[0]).toBe(8_000);
    expect([...opening.audio.slice(-3)]).toEqual([30_001, 30_002, 30_003]);
  });

  it("bounds retained PCM while idle and during provisional capture", () => {
    const subject = createProvisionalListening({ now: () => 100 });
    subject.push(samples(PROVISIONAL_MAX_SAMPLES * 2, 1));
    subject.wakeDetected(32_000);
    subject.push(samples(PROVISIONAL_MAX_SAMPLES * 2, 2));
    expect(subject.finishOpening().audio.length).toBe(PROVISIONAL_MAX_SAMPLES);
  });

  it("zeroes and releases opening audio on every discard path", () => {
    const subject = createProvisionalListening({ now: () => 100 });
    subject.push(samples(40_000, 7));
    subject.wakeDetected(32_000);
    const opening = subject.finishOpening();
    subject.discard("incidental");
    expect(subject.state()).toBe("idle");
    expect([...opening.audio].every((sample) => sample === 0)).toBe(true);
    expect(subject.metadata()).toMatchObject({ state: "idle", verdictId: "incidental", sampleCount: 0 });
  });

  it("returns idle after capture failure and permits the next wake", () => {
    const subject = createProvisionalListening({ now: () => 100 });
    subject.push(samples(40_000, 7));
    subject.wakeDetected(32_000);
    subject.captureFailed("device-lost");
    expect(subject.state()).toBe("idle");
    subject.push(samples(40_000, 8));
    expect(subject.wakeDetected(32_000)).toBe(true);
  });

  it("exposes metadata only and never serializes opening audio", () => {
    const subject = createProvisionalListening({ now: () => 100 });
    subject.push(samples(40_000, 7));
    subject.wakeDetected(32_000);
    subject.finishOpening();
    const metadata = subject.metadata();
    expect(Object.keys(metadata)).toEqual(["state", "startedAt", "endedAt", "sampleCount", "durationMs", "verdictId"]);
    expect(JSON.stringify(metadata)).not.toMatch(/audio|base64|pcm/i);
  });
});

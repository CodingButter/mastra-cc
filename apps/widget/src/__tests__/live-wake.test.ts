import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { INITIAL_FACE_STATE } from "../hiding-model.js";
import { createLiveWakeDetector, decideWakeWindows } from "../live-wake.js";

const acceptedModel = { score: async () => 1 };

function setup() {
  let state = INITIAL_FACE_STATE;
  const decisions: unknown[] = [];
  const onAccept = vi.fn();
  const capture = vi.fn(async () => Buffer.alloc(64, 1));
  const detector = createLiveWakeDetector({
    capture,
    model: acceptedModel,
    state: () => state,
    onDecision: (decision) => decisions.push(decision),
    onAccept,
    threshold: 0.9,
  });
  return {
    detector,
    capture,
    decisions,
    onAccept,
    setState: (next: typeof state) => (state = next),
  };
}

describe("live wake detector", () => {
  it("wakes on a passing phrase without speaker identity", async () => {
    const subject = setup();
    const result = await subject.detector.runOnce();
    expect(result).toMatchObject({ accepted: true, confidence: 1, modelState: "ready" });
    expect(subject.onAccept).toHaveBeenCalledOnce();
  });

  it("does not wake for a non-matching phrase", async () => {
    const subject = createLiveWakeDetector({
      capture: async () => Buffer.alloc(64, 1),
      model: { score: async () => 0.1 },
      state: () => INITIAL_FACE_STATE,
      onDecision: vi.fn(),
      onAccept: vi.fn(),
      threshold: 0.9,
    });
    await expect(subject.runOnce()).resolves.toMatchObject({ accepted: false, confidence: 0.1 });
  });

  it("fails closed when the keyword model is unavailable or malformed", async () => {
    await expect(decideWakeWindows(undefined, new Int16Array(64), 0.9))
      .resolves.toMatchObject({ accepted: false, modelState: "missing" });
    await expect(decideWakeWindows({ score: async () => Number.NaN }, new Int16Array(64), 0.9))
      .resolves.toMatchObject({ accepted: false, modelState: "corrupt" });
  });

  it("does not capture while a voice session owns the gate", async () => {
    const subject = setup();
    subject.setState({ ...INITIAL_FACE_STATE, voiceOpen: true, microphoneGateOpen: true });
    await expect(subject.detector.runOnce()).resolves.toBeUndefined();
    expect(subject.capture).not.toHaveBeenCalled();
  });

  it("dismissal leaves armed wake capture available", async () => {
    const subject = setup();
    subject.setState({ ...INITIAL_FACE_STATE, visible: false });
    expect((await subject.detector.runOnce())?.accepted).toBe(true);
  });

  it("stays closed after device loss until an availability event", async () => {
    const subject = setup();
    subject.capture.mockRejectedValueOnce(new Error("microphone lost"));
    await expect(subject.detector.runOnce()).resolves.toBeUndefined();
    await expect(subject.detector.runOnce()).resolves.toBeUndefined();
    expect(subject.capture).toHaveBeenCalledOnce();

    subject.detector.availabilityChanged();
    expect((await subject.detector.runOnce())?.accepted).toBe(true);
    expect(subject.capture).toHaveBeenCalledTimes(2);
  });

  it("gives a person four seconds to say the wake phrase", () => {
    const adapters = readFileSync(new URL("../wake-adapters.ts", import.meta.url), "utf8");
    expect(adapters).toContain("seconds: 4");
    expect(adapters).not.toContain("seconds: 2");
  });

  it("scores every overlapping phrase window and accepts a later match", async () => {
    const scores = [0.1, 0.4, 1, 0.3, 0.2];
    let scoreIndex = 0;
    const decision = await decideWakeWindows(
      { score: async () => scores[scoreIndex++]! },
      new Int16Array(64_000),
      0.9,
    );
    expect(decision).toMatchObject({ accepted: true, confidence: 1 });
    expect(scoreIndex).toBe(5);
  });

  it("never includes raw audio in the decision result", async () => {
    const result = await setup().detector.runOnce();
    expect(Object.keys(result ?? {})).toEqual(["accepted", "confidence", "threshold", "modelState"]);
    expect(JSON.stringify(result)).not.toContain("audio");
  });

  it("has no runtime dependency on speaker templates, thresholds, or WeSpeaker", () => {
    const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
    const detector = readFileSync(new URL("../live-wake.ts", import.meta.url), "utf8");
    expect(`${main}\n${detector}`).not.toMatch(/speakerEmbedding|SpeakerTemplate|createTemplateStore|wespeaker/i);
  });

  it("signals only the wake event to the hub and never serializes audio", () => {
    const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
    const detector = readFileSync(new URL("../live-wake.ts", import.meta.url), "utf8");
    expect(main).toContain("hub.said();");
    expect(main).not.toMatch(/hub\.said\([^)]/);
    expect(detector).not.toContain("@mastra-cc/transport");
  });
});

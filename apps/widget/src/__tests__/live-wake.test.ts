import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { INITIAL_FACE_STATE } from "../hiding-model.js";
import { createLiveWakeDetector, decideWakeWindow } from "../live-wake.js";

const acceptedModel = { score: async () => 1 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(model = acceptedModel) {
  let state = INITIAL_FACE_STATE;
  const decisions: unknown[] = [];
  const openings: unknown[] = [];
  const metadata: unknown[] = [];
  const detector = createLiveWakeDetector({
    model,
    state: () => state,
    onDecision: (decision) => decisions.push(decision),
    onOpening: (opening) => openings.push(opening),
    onMetadata: (value) => metadata.push(value),
    threshold: 0.9,
  });
  return { detector, decisions, openings, metadata, setState: (next: typeof state) => (state = next) };
}

describe("live wake detector", () => {
  it("opens provisional listening on a passing phrase without opening conversation", async () => {
    const subject = setup();
    subject.detector.acceptSamples(new Int16Array(32_000));
    await flush();
    expect(subject.decisions).toContainEqual(expect.objectContaining({ accepted: true, confidence: 1 }));
    expect(subject.detector.provisionalState()).toBe("capturing-opening");
    expect(subject.metadata).toContainEqual(expect.objectContaining({ state: "capturing-opening" }));
  });

  it("does not wake for a non-matching phrase", async () => {
    const subject = setup({ score: async () => 0.1 });
    subject.detector.acceptSamples(new Int16Array(32_000));
    await flush();
    expect(subject.decisions).toContainEqual(expect.objectContaining({ accepted: false, confidence: 0.1 }));
    expect(subject.detector.provisionalState()).toBe("idle");
  });

  it("fails closed when the keyword model is unavailable or malformed", async () => {
    await expect(decideWakeWindow(undefined, new Int16Array(32_000), 0.9))
      .resolves.toMatchObject({ accepted: false, modelState: "missing" });
    await expect(decideWakeWindow({ score: async () => Number.NaN }, new Int16Array(32_000), 0.9))
      .resolves.toMatchObject({ accepted: false, modelState: "corrupt" });
  });

  it("does not inspect microphone samples while a voice session owns the gate", async () => {
    const model = { score: vi.fn(async () => 1) };
    const subject = setup(model);
    subject.setState({ ...INITIAL_FACE_STATE, voiceOpen: true, microphoneGateOpen: true });
    subject.detector.acceptSamples(new Int16Array(32_000));
    await flush();
    expect(model.score).not.toHaveBeenCalled();
  });

  it("dismissal leaves armed wake listening available", async () => {
    const subject = setup();
    subject.setState({ ...INITIAL_FACE_STATE, visible: false });
    subject.detector.acceptSamples(new Int16Array(32_000));
    await flush();
    expect(subject.detector.provisionalState()).toBe("capturing-opening");
  });

  it("stays closed after device loss until an availability event", async () => {
    const model = { score: vi.fn(async () => 1) };
    const subject = setup(model);
    subject.detector.captureFailed("microphone-lost");
    subject.detector.acceptSamples(new Int16Array(32_000));
    await flush();
    expect(model.score).not.toHaveBeenCalled();
    subject.detector.availabilityChanged();
    subject.detector.acceptSamples(new Int16Array(32_000));
    await flush();
    expect(model.score).toHaveBeenCalledOnce();
  });

  it("retains the complete opening until utterance end", async () => {
    const subject = setup();
    subject.detector.acceptSamples(Int16Array.from({ length: 32_000 }, () => 1));
    await flush();
    subject.detector.acceptSamples(Int16Array.from({ length: 320 }, () => 8_000));
    for (let index = 0; index < 30; index += 1) subject.detector.acceptSamples(new Int16Array(320));
    expect(subject.openings).toHaveLength(1);
    expect(subject.openings[0]).toMatchObject({ sampleRate: 16_000, channels: 1, sampleFormat: "s16le" });
    expect((subject.openings[0] as { audio: Int16Array }).audio.length).toBe(32_000 + 320 + 9_600);
    expect(subject.detector.provisionalState()).toBe("awaiting-directedness");
  });

  it("suppresses duplicate wake evaluation during provisional capture", async () => {
    const model = { score: vi.fn(async () => 1) };
    const subject = setup(model);
    subject.detector.acceptSamples(new Int16Array(32_000));
    await flush();
    subject.detector.acceptSamples(new Int16Array(32_000));
    await flush();
    expect(model.score).toHaveBeenCalledOnce();
  });

  it("never includes raw audio in wake or provisional telemetry", async () => {
    const subject = setup();
    subject.detector.acceptSamples(new Int16Array(32_000));
    await flush();
    expect(JSON.stringify(subject.decisions)).not.toMatch(/audio|base64|pcm/i);
    expect(JSON.stringify(subject.metadata)).not.toMatch(/audio|base64|pcm/i);
  });

  it("has one continuous production microphone owner", () => {
    const adapter = readFileSync(new URL("../wake-adapters.ts", import.meta.url), "utf8");
    expect(adapter).toContain("startWidgetMicrophone");
    expect(adapter).not.toContain(["createMicrophone", "Capture"].join(""));
    expect(adapter).not.toContain("seconds:");
  });

  it("has no runtime dependency on speaker identity", () => {
    const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
    const detector = readFileSync(new URL("../live-wake.ts", import.meta.url), "utf8");
    expect(`${main}\n${detector}`).not.toMatch(/speakerEmbedding|SpeakerTemplate|createTemplateStore|wespeaker/i);
  });

  it("visibly distinguishes active capture from completed capture", () => {
    const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
    expect(main).toContain('caption: "Listening — speak naturally"');
    expect(main).toContain('caption: "Captured — deciding if you meant Mastra"');
  });

  it("never serializes opening audio or bypasses the admission boundary", () => {
    const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
    expect(main).not.toContain("acceptWake(state)");
    expect(main).toContain("admitOpening({");
    expect(main).not.toMatch(/JSON\.stringify\([^\n]*(audio|opening)/i);
  });
});

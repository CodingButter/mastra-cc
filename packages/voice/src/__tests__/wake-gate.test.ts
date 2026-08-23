import { describe, expect, it } from "vitest";
import {
  combineWakeDecisions,
  decideKeyword,
  decideSpeaker,
  speakerCosineDistance,
  type SpeakerTemplateBank,
} from "../index.js";

const templates: SpeakerTemplateBank = {
  revision: 7,
  fingerprints: [
    [1, 0, 0],
    [0.9, 0.1, 0],
  ],
};

describe("separated wake decisions", () => {
  it("accepts and rejects keyword confidence without speaker input", () => {
    expect(decideKeyword(0.81, 0.8, "ready").accepted).toBe(true);
    expect(decideKeyword(0.79, 0.8, "ready").accepted).toBe(false);
  });

  it("accepts and rejects speaker identity without keyword input", () => {
    expect(decideSpeaker([0.98, 0.02, 0], templates, 0.02).accepted).toBe(true);
    expect(decideSpeaker([0, 1, 0], templates, 0.02).accepted).toBe(false);
  });

  it("requires both independent decisions", () => {
    const keywordAccepted = decideKeyword(0.9, 0.8, "ready");
    const keywordRejected = decideKeyword(0.7, 0.8, "ready");
    const speakerAccepted = decideSpeaker([1, 0, 0], templates, 0.02);
    const speakerRejected = decideSpeaker([0, 1, 0], templates, 0.02);

    expect(combineWakeDecisions(keywordAccepted, speakerAccepted).accepted).toBe(true);
    expect(combineWakeDecisions(keywordRejected, speakerAccepted).accepted).toBe(false);
    expect(combineWakeDecisions(keywordAccepted, speakerRejected).accepted).toBe(false);
  });

  it("fails closed when no enrolled speaker templates exist", () => {
    const decision = decideSpeaker([1, 0, 0], { revision: 0, fingerprints: [] }, 0.02);

    expect(decision.accepted).toBe(false);
    expect(decision.distance).toBe(Number.POSITIVE_INFINITY);
    expect(decision.templateRevision).toBe(0);
  });

  it("fails closed for missing or corrupt models", () => {
    expect(decideKeyword(1, 0.8, "missing").accepted).toBe(false);
    expect(decideKeyword(1, 0.8, "corrupt").accepted).toBe(false);
  });

  it("fails closed for malformed scores and fingerprints", () => {
    expect(decideKeyword(Number.NaN, 0.8, "ready").accepted).toBe(false);
    expect(decideKeyword(1.2, 0.8, "ready").accepted).toBe(false);
    expect(decideSpeaker([0, 0, 0], templates, 0.02).accepted).toBe(false);
    expect(decideSpeaker([1, 0], templates, 0.02).accepted).toBe(false);
  });

  it("uses cosine distance for speaker fingerprints", () => {
    expect(speakerCosineDistance([1, 0], [1, 0])).toBeCloseTo(0);
    expect(speakerCosineDistance([1, 0], [0, 1])).toBeCloseTo(1);
  });
});

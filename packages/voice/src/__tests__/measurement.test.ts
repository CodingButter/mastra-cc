import { describe, expect, it } from "vitest";

import {
  assertDisjointCohorts,
  freezeThresholds,
  keywordMargin,
  offsetVerdict,
  speakerMargin,
} from "../index.js";

describe("the frozen wake measurement contract", () => {
  it("rejects overlapping cohort member ids", () => {
    expect(() =>
      assertDisjointCohorts({ enrolment: ["e1", "shared"], calibration: ["shared"], evaluation: ["v1"] }),
    ).toThrow(/shared/);
  });

  it("selects thresholds from calibration and shipping banks only", () => {
    const frozen = freezeThresholds({
      keywordCalibration: [0.99, 0.98, 0.97, 0.96, 0.95, 0.94, 0.93, 0.92, 0.2, 0.1],
      keywordNegatives: [0.3, 0.4],
      speakerCalibration: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.9, 1],
      speakerNegatives: [0.2, 0.3],
    });

    expect(frozen).toEqual({ keyword: 0.92, speaker: 0.08 });
  });

  it("refuses threshold laundering when either bank has no satisfying value", () => {
    expect(() =>
      freezeThresholds({
        keywordCalibration: Array<number>(10).fill(0.8),
        keywordNegatives: [0.9],
        speakerCalibration: Array<number>(10).fill(0.1),
        speakerNegatives: [0.2],
      }),
    ).toThrow(/keyword/);
  });

  it("reports the declared score-direction margins", () => {
    expect(keywordMargin(0.9, 0.8)).toBeCloseTo(0.125);
    expect(speakerMargin(0.72, 0.8)).toBeCloseTo(0.1);
  });

  it("derives the offset verdict from the fifth leave-one-out value and live median", () => {
    expect(offsetVerdict([0.1, 0.2, 0.3, 0.4, 0.5], [0.1, 0.2, 0.3, 0.4, 0.4, 0.5, 0.5, 0.5, 0.6, 0.7])).toEqual({
      templateP95: 0.5,
      liveMedian: 0.45,
      medianInside: true,
      eightOfTenInside: true,
      verdict: "GREEN",
    });
  });
});

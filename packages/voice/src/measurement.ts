export function assertDisjointCohorts(cohorts: Readonly<Record<string, readonly string[]>>): void {
  const owners = new Map<string, string>();
  for (const [cohort, ids] of Object.entries(cohorts)) {
    for (const id of ids) {
      const owner = owners.get(id);
      if (owner !== undefined) throw new Error(`attempt ${id} belongs to both ${owner} and ${cohort}`);
      owners.set(id, cohort);
    }
  }
}

function finite(values: readonly number[], name: string): number[] {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`${name} must contain finite scores`);
  }
  return [...values].sort((left, right) => left - right);
}

export function freezeThresholds(input: Readonly<{
  keywordCalibration: readonly number[];
  keywordNegatives: readonly number[];
  speakerCalibration: readonly number[];
  speakerNegatives: readonly number[];
}>): Readonly<{ keyword: number; speaker: number }> {
  const keywordCalibration = finite(input.keywordCalibration, "keyword calibration");
  const keywordNegatives = finite(input.keywordNegatives, "keyword negatives");
  const keywordAccepted = Math.ceil(keywordCalibration.length * 0.8);
  const keyword = keywordCalibration[keywordCalibration.length - keywordAccepted];
  if (keywordNegatives.some((score) => score >= keyword)) {
    throw new Error("keyword axis has no threshold satisfying calibration recall and zero false accepts");
  }

  const speakerCalibration = finite(input.speakerCalibration, "speaker calibration");
  const speakerNegatives = finite(input.speakerNegatives, "speaker negatives");
  const speakerAccepted = Math.ceil(speakerCalibration.length * 0.8);
  const speaker = speakerCalibration[speakerAccepted - 1];
  if (speakerNegatives.some((distance) => distance <= speaker)) {
    throw new Error("speaker axis has no threshold satisfying calibration recall and zero false accepts");
  }

  return { keyword, speaker };
}

export function keywordMargin(score: number, threshold: number): number {
  return (score - threshold) / Math.max(threshold, 1e-9);
}

export function speakerMargin(distance: number, threshold: number): number {
  return (threshold - distance) / Math.max(threshold, 1e-9);
}

export function offsetVerdict(
  leaveOneOutDistances: readonly number[],
  liveCalibrationDistances: readonly number[],
): Readonly<{
  templateP95: number;
  liveMedian: number;
  medianInside: boolean;
  eightOfTenInside: boolean;
  verdict: "GREEN" | "RED";
}> {
  if (leaveOneOutDistances.length !== 5 || liveCalibrationDistances.length !== 10) {
    throw new Error("offset verdict requires five template and ten live calibration distances");
  }
  const templates = finite(leaveOneOutDistances, "leave-one-out distances");
  const live = finite(liveCalibrationDistances, "live calibration distances");
  const templateP95 = templates[Math.ceil(0.95 * templates.length) - 1];
  const liveMedian = (live[4] + live[5]) / 2;
  const medianInside = liveMedian <= templateP95;
  const eightOfTenInside = live.filter((distance) => distance <= templateP95).length >= 8;
  return {
    templateP95,
    liveMedian,
    medianInside,
    eightOfTenInside,
    verdict: medianInside && eightOfTenInside ? "GREEN" : "RED",
  };
}

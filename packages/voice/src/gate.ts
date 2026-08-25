export type WakeModelState = "ready" | "missing" | "corrupt";

export type KeywordDecision = Readonly<{
  accepted: boolean;
  confidence: number;
  threshold: number;
  modelState: WakeModelState;
}>;

export function decideKeyword(
  confidence: number,
  threshold: number,
  modelState: WakeModelState,
): KeywordDecision {
  const valid =
    modelState === "ready" &&
    Number.isFinite(confidence) &&
    confidence >= 0 &&
    confidence <= 1 &&
    Number.isFinite(threshold) &&
    threshold >= 0 &&
    threshold <= 1;

  return {
    accepted: valid && confidence >= threshold,
    confidence,
    threshold,
    modelState,
  };
}

export type SpeakerFingerprint = readonly number[];

export type SpeakerTemplateBank = Readonly<{
  revision: number;
  fingerprints: readonly SpeakerFingerprint[];
}>;

export type WakeModelState = "ready" | "missing" | "corrupt";

export type KeywordDecision = Readonly<{
  accepted: boolean;
  confidence: number;
  threshold: number;
  modelState: WakeModelState;
}>;

export type SpeakerDecision = Readonly<{
  accepted: boolean;
  distance: number;
  threshold: number;
  templateRevision: number;
}>;

export type WakeDecision = Readonly<{
  accepted: boolean;
  keyword: KeywordDecision;
  speaker: SpeakerDecision;
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

export function speakerCosineDistance(
  fingerprint: SpeakerFingerprint,
  template: SpeakerFingerprint,
): number {
  if (fingerprint.length === 0 || fingerprint.length !== template.length) {
    return Number.POSITIVE_INFINITY;
  }

  let dot = 0;
  let fingerprintNorm = 0;
  let templateNorm = 0;
  for (let index = 0; index < fingerprint.length; index += 1) {
    const left = fingerprint[index];
    const right = template[index];
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      return Number.POSITIVE_INFINITY;
    }
    dot += left * right;
    fingerprintNorm += left * left;
    templateNorm += right * right;
  }

  if (fingerprintNorm === 0 || templateNorm === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return 1 - dot / Math.sqrt(fingerprintNorm * templateNorm);
}

export function decideSpeaker(
  fingerprint: SpeakerFingerprint,
  templates: SpeakerTemplateBank,
  threshold: number,
): SpeakerDecision {
  const distance = templates.fingerprints.reduce(
    (nearest, template) => Math.min(nearest, speakerCosineDistance(fingerprint, template)),
    Number.POSITIVE_INFINITY,
  );
  const validThreshold = Number.isFinite(threshold) && threshold >= 0;

  return {
    accepted: validThreshold && Number.isFinite(distance) && distance <= threshold,
    distance,
    threshold,
    templateRevision: templates.revision,
  };
}

export function combineWakeDecisions(
  keyword: KeywordDecision,
  speaker: SpeakerDecision,
): WakeDecision {
  return {
    accepted: keyword.accepted && speaker.accepted,
    keyword,
    speaker,
  };
}

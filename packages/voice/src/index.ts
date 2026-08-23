export {
  ENROLMENT_CAPTURE_ADAPTER,
  LIVE_CAPTURE_ADAPTER,
  VOICE_CAPTURE_OPTIONS,
  fingerprintFrames,
  modelInputWindow,
  normalizeCapturedAudio,
  processEnrolmentCapture,
  processLiveCapture,
} from "./audio.js";
export type { CapturedAudioFormat, ProcessedCapture, VoiceCaptureOptions } from "./audio.js";

export {
  assertDisjointCohorts,
  freezeThresholds,
  keywordMargin,
  offsetVerdict,
  speakerMargin,
} from "./measurement.js";

export {
  combineWakeDecisions,
  decideKeyword,
  decideSpeaker,
  speakerCosineDistance,
} from "./gate.js";
export type {
  KeywordDecision,
  SpeakerDecision,
  SpeakerFingerprint,
  SpeakerTemplateBank,
  WakeDecision,
  WakeModelState,
} from "./gate.js";

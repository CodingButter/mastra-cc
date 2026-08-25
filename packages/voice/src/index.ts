export {
  LIVE_CAPTURE_ADAPTER,
  VOICE_CAPTURE_OPTIONS,
  modelInputWindow,
  normalizeCapturedAudio,
  overlappingWakeWindows,
  processLiveCapture,
} from "./audio.js";
export type { CapturedAudioFormat, ProcessedCapture, VoiceCaptureOptions } from "./audio.js";

export { decideKeyword } from "./gate.js";
export type { KeywordDecision, WakeModelState } from "./gate.js";

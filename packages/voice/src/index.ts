export {
  LIVE_CAPTURE_ADAPTER,
  UTTERANCE_FRAME_SAMPLES,
  UTTERANCE_MAX_SAMPLES,
  UTTERANCE_TRAILING_SILENCE_SAMPLES,
  VOICE_CAPTURE_OPTIONS,
  advanceUtteranceEnd,
  createUtteranceEndState,
  modelInputWindow,
  normalizeCapturedAudio,
  overlappingWakeWindows,
  processLiveCapture,
} from "./audio.js";
export type { CapturedAudioFormat, ProcessedCapture, UtteranceEndState, VoiceCaptureOptions } from "./audio.js";

export { decideKeyword } from "./gate.js";
export type { KeywordDecision, WakeModelState } from "./gate.js";

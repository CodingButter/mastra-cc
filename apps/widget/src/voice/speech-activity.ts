import {
  UTTERANCE_FRAME_SAMPLES,
  advanceUtteranceEnd,
  createUtteranceEndState,
  type UtteranceEndState,
} from "@mastra-cc/voice";

export const SPEECH_ACTIVITY_REARM_SAMPLES = UTTERANCE_FRAME_SAMPLES * 10;

export type SpeechActivityState = Readonly<{
  utterance: UtteranceEndState;
  rearmSilenceSamples: number;
}>;

export function createSpeechActivityState(): SpeechActivityState {
  return { utterance: createUtteranceEndState(), rearmSilenceSamples: 0 };
}

export function advanceSpeechActivity(
  state: SpeechActivityState,
  samples: Int16Array,
): Readonly<{ state: SpeechActivityState; onset: boolean }> {
  if (state.utterance.ended) {
    const resumed = advanceUtteranceEnd(createUtteranceEndState(), samples);
    if (resumed.speechBegan) {
      return { state: { utterance: resumed, rearmSilenceSamples: 0 }, onset: false };
    }
    const rearmSilenceSamples = state.rearmSilenceSamples + samples.length;
    return {
      state: rearmSilenceSamples >= SPEECH_ACTIVITY_REARM_SAMPLES
        ? createSpeechActivityState()
        : { ...state, rearmSilenceSamples },
      onset: false,
    };
  }

  const utterance = advanceUtteranceEnd(state.utterance, samples);
  return {
    state: { utterance, rearmSilenceSamples: 0 },
    onset: !state.utterance.speechBegan && utterance.speechBegan,
  };
}

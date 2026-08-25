import { describe, expect, it } from "vitest";

import {
  SPEECH_ACTIVITY_REARM_SAMPLES,
  advanceSpeechActivity,
  createSpeechActivityState,
} from "../voice/speech-activity.js";

const speech = Int16Array.from({ length: 320 }, () => 8_000);
const silence = new Int16Array(320);

function feedSilence(state: ReturnType<typeof createSpeechActivityState>, samples: number) {
  let current = state;
  for (let offset = 0; offset < samples; offset += silence.length) {
    current = advanceSpeechActivity(current, silence).state;
  }
  return current;
}

describe("active-session speech activity", () => {
  it("does not report a second onset when speech resumes during the rearm boundary", () => {
    let result = advanceSpeechActivity(createSpeechActivityState(), speech);
    expect(result.onset).toBe(true);

    let state = feedSilence(result.state, 9_600);
    expect(state.utterance.ended).toBe(true);
    result = advanceSpeechActivity(state, speech);

    expect(result.onset).toBe(false);
    expect(result.state.utterance.speechBegan).toBe(true);
    expect(result.state.utterance.ended).toBe(false);
  });

  it("reports a new onset after the completed utterance has remained silent", () => {
    let state = advanceSpeechActivity(createSpeechActivityState(), speech).state;
    state = feedSilence(state, 9_600 + SPEECH_ACTIVITY_REARM_SAMPLES);

    const result = advanceSpeechActivity(state, speech);
    expect(result.onset).toBe(true);
  });
});

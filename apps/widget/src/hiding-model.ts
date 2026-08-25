import type { LaneFrame } from "@mastra-cc/transport";

export interface FaceState {
  readonly visible: boolean;
  readonly caption?: string;
  readonly working: boolean;
  readonly voiceOpen: boolean;
  /** M5 gives this state consequence. M4 proves dismissal cannot change it. */
  readonly armed: boolean;
  /** The microphone side does not exist in M4; only its session gate does. */
  readonly microphoneGateOpen: boolean;
}

export const INITIAL_FACE_STATE: FaceState = {
  visible: true,
  working: false,
  voiceOpen: false,
  armed: true,
  microphoneGateOpen: false,
};

export function applyFrame(state: FaceState, frame: LaneFrame): FaceState {
  switch (frame.event) {
    case "progress":
      return { ...state, visible: true, working: true, caption: frame.detail };
    case "answer":
      return { ...state, visible: true, working: false, caption: frame.detail };
    case "voice_opened":
      return { ...state, voiceOpen: true, microphoneGateOpen: true };
    case "voice_closed":
      return { ...state, voiceOpen: false, microphoneGateOpen: false };
  }
}

/**
 * The one dismissal path. A tray click calls this function, and M5's spoken
 * phrase matcher calls this same function. Dismissal changes presentation only:
 * work, wake arming, voice state, and the session gate survive untouched.
 */
export function acceptWake(state: FaceState): FaceState {
  return { ...state, visible: true, voiceOpen: true, microphoneGateOpen: true };
}

export function dismissFace(state: FaceState): FaceState {
  const { caption: _caption, ...rest } = state;
  return { ...rest, visible: false };
}

const DISMISSALS = new Set(["no", "never mind", "shut up"]);

export function isSpokenDismissal(utterance: string): boolean {
  return DISMISSALS.has(utterance.trim().toLowerCase());
}

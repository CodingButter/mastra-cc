import type { VoiceDialResult } from "@mastra-cc/transport";

import type { BufferedOpening } from "../provisional-listening.js";
import type { MicrophoneSource } from "./provider-session.js";

interface AdmissionHub {
  mintVoiceDial(signal?: AbortSignal): Promise<VoiceDialResult>;
}

interface AdmissionDetector {
  discard(reason: string): void;
}

interface AdmissionProvider {
  open(ticket: Pick<Extract<VoiceDialResult, { ok: true }>, "token" | "model">): Promise<void>;
  enqueuePcm(opening: Int16Array): Promise<void>;
  startLiveContinuation(source: MicrophoneSource): void;
}

export async function admitOpening(options: Readonly<{
  opening: BufferedOpening;
  hub: AdmissionHub;
  detector: AdmissionDetector;
  provider: AdmissionProvider;
  microphone: MicrophoneSource;
  signal?: AbortSignal;
}>): Promise<boolean> {
  const ticket = await options.hub.mintVoiceDial(options.signal);
  if (!ticket.ok) {
    options.detector.discard(ticket.code);
    return false;
  }

  await options.provider.open(ticket);
  await options.provider.enqueuePcm(options.opening.audio);
  options.provider.startLiveContinuation(options.microphone);
  return true;
}

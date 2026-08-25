import type { DirectednessOpening, DirectednessResult, VoiceDialResult } from "@mastra-cc/transport";

import type { BufferedOpening } from "../provisional-listening.js";
import type { MicrophoneSource } from "./provider-session.js";

interface AdmissionHub {
  classifyDirectedness(opening: DirectednessOpening, signal?: AbortSignal): Promise<DirectednessResult>;
  mintVoiceDial(signal?: AbortSignal): Promise<VoiceDialResult>;
}

interface AdmissionDetector {
  admit(id: string): void;
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
  const verdict = await options.hub.classifyDirectedness(
    {
      audio: options.opening.audio,
      sampleRate: options.opening.sampleRate,
      channels: options.opening.channels,
      sampleFormat: options.opening.sampleFormat,
    },
    options.signal,
  );
  if (verdict.verdict !== "directed") {
    options.detector.discard(verdict.reason);
    return false;
  }

  const ticket = await options.hub.mintVoiceDial(options.signal);
  if (!ticket.ok) {
    options.detector.discard(ticket.code);
    return false;
  }

  await options.provider.open(ticket);
  await options.provider.enqueuePcm(options.opening.audio);
  options.detector.admit(verdict.id);
  options.provider.startLiveContinuation(options.microphone);
  return true;
}

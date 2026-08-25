import type { CapturedAudioFormat } from "@mastra-cc/voice";
import { createMicrophoneStream, type MicrophoneStream } from "@mastra-cc/voice/node";

export const WIDGET_CAPTURE_FORMAT: CapturedAudioFormat = Object.freeze({
  sampleRate: 16_000,
  channels: 1,
  sampleFormat: "s16le",
});

export function startWidgetMicrophone(options: Readonly<{
  onSamples(samples: Int16Array): void;
  onError(error: Error): void;
  signal?: AbortSignal;
}>): MicrophoneStream {
  return createMicrophoneStream({
    device: process.env.MASTRA_CC_MICROPHONE_DEVICE ?? "plughw:0,6",
    onSamples: options.onSamples,
    onError: options.onError,
    signal: options.signal,
  });
}

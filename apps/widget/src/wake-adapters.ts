import { processLiveCapture, type CapturedAudioFormat, type ProcessedCapture } from "@mastra-cc/voice";
import { createMicrophoneCapture } from "@mastra-cc/voice/node";

export const WIDGET_CAPTURE_FORMAT: CapturedAudioFormat = Object.freeze({
  sampleRate: 16_000,
  channels: 1,
  sampleFormat: "s16le",
});

export async function captureWakeAudio(signal?: AbortSignal): Promise<Buffer> {
  return await createMicrophoneCapture(
    { device: process.env.MASTRA_CC_MICROPHONE_DEVICE ?? "plughw:0,6", seconds: 4 },
    signal,
  );
}

export function adaptLiveCapture(raw: Buffer): ProcessedCapture {
  return processLiveCapture(raw, WIDGET_CAPTURE_FORMAT);
}

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import * as ort from "onnxruntime-node";

import { modelInputWindow } from "./audio.js";

export type WakeModelPayload = Readonly<{
  featureModelPath: string;
  keywordModelPath: string;
}>;

export type WakeKeywordModel = Readonly<{
  score(normalized: Int16Array): Promise<number>;
}>;

export function packagedWakeModelPayload(): WakeModelPayload {
  return {
    featureModelPath: fileURLToPath(new URL("../models/speech-embedding.onnx", import.meta.url)),
    keywordModelPath: fileURLToPath(new URL("../models/hey-mastra-keyword.onnx", import.meta.url)),
  };
}

export async function loadWakeKeywordModel(payload: WakeModelPayload): Promise<WakeKeywordModel> {
  const feature = await ort.InferenceSession.create(payload.featureModelPath);
  const keyword = await ort.InferenceSession.create(payload.keywordModelPath);
  return {
    async score(normalized) {
      const samples = modelInputWindow(normalized);
      const features = await feature.run({ audio_samples: new ort.Tensor("float32", samples, [1, 32_000]) });
      const embeddings = features.embeddings;
      if (embeddings === undefined || embeddings.data.length !== 16 * 96) {
        throw new Error("feature model returned invalid embeddings");
      }
      const probabilities = await keyword.run({
        embeddings: new ort.Tensor("float32", embeddings.data as Float32Array, [1, 16 * 96]),
      });
      const output = probabilities.probabilities;
      if (output === undefined || output.data.length < 2) throw new Error("keyword model returned no probability");
      const score = Number(output.data[1]);
      if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error("keyword model returned an invalid probability");
      return score;
    },
  };
}

export type MicrophoneStreamRequest = Readonly<{
  device: string;
  onSamples(samples: Int16Array): void;
  onError?(error: Error): void;
  signal?: AbortSignal;
}>;

export type MicrophoneStream = Readonly<{
  close(): void;
}>;

export function microphoneStreamCommand(request: Pick<MicrophoneStreamRequest, "device">): Readonly<{
  command: "arecord";
  args: readonly string[];
}> {
  if (request.device.length === 0) throw new Error("microphone stream requires a device");
  return {
    command: "arecord",
    args: [
      "--quiet",
      "--device",
      request.device,
      "--format",
      "S16_LE",
      "--channels",
      "1",
      "--rate",
      "16000",
      "--file-type",
      "raw",
    ],
  };
}

export function createMicrophoneStream(request: MicrophoneStreamRequest): MicrophoneStream {
  const invocation = microphoneStreamCommand(request);
  const child = spawn(invocation.command, invocation.args, {
    signal: request.signal,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let remainder: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let errorText = "";
  let closed = false;
  child.stdout.on("data", (chunk: Buffer) => {
    const bytes = remainder.length === 0 ? chunk : Buffer.concat([remainder, chunk]);
    const completeBytes = bytes.length - (bytes.length % 2);
    if (completeBytes > 0) {
      const samples = new Int16Array(completeBytes / 2);
      for (let index = 0; index < samples.length; index += 1) samples[index] = bytes.readInt16LE(index * 2);
      request.onSamples(samples);
    }
    remainder = bytes.subarray(completeBytes);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    errorText += chunk.toString("utf8");
  });
  child.once("error", (error) => request.onError?.(error));
  child.once("close", (code) => {
    if (!closed && code !== 0) request.onError?.(new Error(`microphone stream failed (${code ?? "signal"}): ${errorText.trim()}`));
  });
  return {
    close() {
      closed = true;
      child.kill();
    },
  };
}

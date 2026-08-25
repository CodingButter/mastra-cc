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

export type MicrophoneCaptureRequest = Readonly<{
  device: string;
  seconds: number;
}>;

export function microphoneCaptureCommand(request: MicrophoneCaptureRequest): Readonly<{
  command: "arecord";
  args: readonly string[];
}> {
  if (request.device.length === 0 || !Number.isInteger(request.seconds) || request.seconds <= 0) {
    throw new Error("microphone capture requires a device and positive whole-second duration");
  }
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
      "--duration",
      String(request.seconds),
      "--file-type",
      "raw",
    ],
  };
}

export async function createMicrophoneCapture(
  request: MicrophoneCaptureRequest,
  signal?: AbortSignal,
): Promise<Buffer> {
  const invocation = microphoneCaptureCommand(request);
  return await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let errorText = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      errorText += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`microphone capture failed (${code ?? "signal"}): ${errorText.trim()}`));
    });
  });
}

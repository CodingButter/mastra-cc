import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import * as ort from "onnxruntime-node";

import { modelInputWindow } from "./audio.js";
import type { SpeakerTemplateBank } from "./gate.js";

export type WakeModelPayload = Readonly<{
  featureModelPath: string;
  keywordModelPath: string;
}>;

export type WakeKeywordModel = Readonly<{
  score(normalized: Int16Array): Promise<number>;
  speakerEmbedding(normalized: Int16Array): Promise<readonly number[]>;
}>;

export async function loadWakeKeywordModel(payload: WakeModelPayload): Promise<WakeKeywordModel> {
  const feature = await ort.InferenceSession.create(payload.featureModelPath);
  const keyword = await ort.InferenceSession.create(payload.keywordModelPath);
  async function embeddings(normalized: Int16Array): Promise<Float32Array> {
    const samples = modelInputWindow(normalized);
    const result = await feature.run({ audio_samples: new ort.Tensor("float32", samples, [1, 32_000]) });
    const output = result.embeddings;
    if (output === undefined || output.data.length !== 16 * 96) throw new Error("feature model returned invalid embeddings");
    return output.data as Float32Array;
  }
  return {
    async score(normalized) {
      const featureOutput = await embeddings(normalized);
      const probabilities = await keyword.run({
        embeddings: new ort.Tensor("float32", featureOutput, [1, 16 * 96]),
      });
      const output = probabilities.probabilities;
      if (output === undefined || output.data.length < 2) throw new Error("keyword model returned no probability");
      const score = Number(output.data[1]);
      if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error("keyword model returned an invalid probability");
      return score;
    },
    async speakerEmbedding(normalized) {
      const featureOutput = await embeddings(normalized);
      const pooled = Array.from({ length: 96 }, (_, dimension) => {
        let sum = 0;
        for (let frame = 0; frame < 16; frame += 1) sum += featureOutput[frame * 96 + dimension]!;
        return sum / 16;
      });
      const norm = Math.sqrt(pooled.reduce((sum, value) => sum + value * value, 0));
      if (!Number.isFinite(norm) || norm === 0) throw new Error("feature model returned an invalid speaker embedding");
      return pooled.map((value) => value / norm);
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

function isBank(value: unknown): value is SpeakerTemplateBank {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SpeakerTemplateBank>;
  return (
    Number.isSafeInteger(candidate.revision) &&
    (candidate.revision ?? -1) >= 0 &&
    Array.isArray(candidate.fingerprints) &&
    candidate.fingerprints.every(
      (fingerprint) =>
        Array.isArray(fingerprint) &&
        fingerprint.length > 0 &&
        fingerprint.every((entry) => Number.isFinite(entry)),
    )
  );
}

export type TemplateStore = Readonly<{
  read(): SpeakerTemplateBank;
  publish(fingerprints: readonly (readonly number[])[]): SpeakerTemplateBank;
}>;

export function createTemplateStore(path: string): TemplateStore {
  const empty: SpeakerTemplateBank = { revision: 0, fingerprints: [] };
  return {
    read() {
      try {
        const value: unknown = JSON.parse(readFileSync(path, "utf8"));
        return isBank(value) ? value : empty;
      } catch {
        return empty;
      }
    },
    publish(fingerprints) {
      if (
        fingerprints.length === 0 ||
        fingerprints.some(
          (fingerprint) => fingerprint.length === 0 || fingerprint.some((entry) => !Number.isFinite(entry)),
        )
      ) {
        throw new Error("template publication requires a non-empty finite fingerprint bank");
      }
      const current = this.read();
      const next: SpeakerTemplateBank = {
        revision: current.revision + 1,
        fingerprints: fingerprints.map((fingerprint) => [...fingerprint]),
      };
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(`${path}.next`, `${JSON.stringify(next)}\n`, { mode: 0o600 });
      renameSync(`${path}.next`, path);
      return next;
    },
  };
}

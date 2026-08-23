import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import { offsetVerdict, speakerCosineDistance, type SpeakerFingerprint } from "@mastra-cc/voice";
import { loadWakeKeywordModel } from "@mastra-cc/voice/node";
import { adaptEnrolmentCapture, adaptLiveCapture, captureWakeAudio } from "./wake-adapters.js";

const output = process.argv[2];
if (output === undefined) throw new Error("offset spike requires an output JSON path");
const device = process.env.MASTRA_CC_MICROPHONE_DEVICE ?? "plughw:0,6";
const input = createInterface({ input: process.stdin, output: process.stdout });
const rows: Array<Record<string, unknown>> = [];
const models = join(import.meta.dirname, "../../../packages/voice/models");
const keywordModel = await loadWakeKeywordModel({
  featureModelPath: join(models, "speech-embedding.onnx"),
  keywordModelPath: join(models, "hey-mastra-keyword.onnx"),
});

async function capture(kind: "enrolment" | "calibration", number: number): Promise<SpeakerFingerprint> {
  if (process.env.MASTRA_CC_AUTO_CAPTURE === "1") {
    console.log(`${kind} take ${number} in 3`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    console.log("2");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    console.log("1");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    console.log("SPEAK: hey mastra");
  } else {
    await input.question(`${kind} take ${number}: press Enter, then say hey mastra once. `);
  }
  const raw = await captureWakeAudio();
  const processed = kind === "enrolment" ? adaptEnrolmentCapture(raw) : adaptLiveCapture(raw);
  if (processed.fingerprint.length === 0) throw new Error(`${kind} take ${number} contained no phrase`);
  const bytes = Buffer.from(processed.normalized.buffer, processed.normalized.byteOffset, processed.normalized.byteLength);
  const [keywordScore, speakerEmbedding] = await Promise.all([
    keywordModel.score(processed.normalized),
    keywordModel.speakerEmbedding(processed.normalized),
  ]);
  rows.push({
    attemptId: `${kind}-${String(number).padStart(2, "0")}`,
    cohort: kind,
    normalizedSha256: createHash("sha256").update(bytes).digest("hex"),
    keywordScore,
    speakerEmbedding,
  });
  return speakerEmbedding;
}

try {
  const templates: SpeakerFingerprint[] = [];
  for (let number = 1; number <= 5; number += 1) templates.push(await capture("enrolment", number));
  const calibration: SpeakerFingerprint[] = [];
  for (let number = 1; number <= 10; number += 1) calibration.push(await capture("calibration", number));

  const leaveOneOut = templates.map((template, index) =>
    Math.min(
      ...templates
        .filter((_, candidate) => candidate !== index)
        .map((candidate) => speakerCosineDistance(template, candidate)),
    ),
  );
  const live = calibration.map((fingerprint) =>
    Math.min(...templates.map((template) => speakerCosineDistance(fingerprint, template))),
  );
  const verdict = offsetVerdict(leaveOneOut, live);
  writeFileSync(
    output,
    `${JSON.stringify({ schemaVersion: 1, device, pid: process.pid, rows, leaveOneOut, live, ...verdict }, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(`OFFSET SPIKE: ${verdict.verdict}`);
  console.log(`templateP95=${verdict.templateP95} liveMedian=${verdict.liveMedian}`);
  process.exitCode = verdict.verdict === "GREEN" ? 0 : 1;
} finally {
  input.close();
}

import type {
  DirectednessReason,
  DirectednessRequest,
  DirectednessResult,
  DirectednessVerdict,
} from "@mastra-cc/transport";

import {
  resolveModel,
  type CredentialStore,
  type ModelConfiguration,
  type Resolution,
} from "../models/configure.js";

const DIRECTEDNESS_TIMEOUT_MS = 8_000;
const VERDICTS = new Set<DirectednessVerdict>(["directed", "incidental", "uncertain"]);
const REASONS = new Set<DirectednessReason>([
  "addressed-mastra",
  "addressed-elsewhere",
  "malformed-answer",
]);

export interface DirectednessClassifierOptions {
  readonly configuration: ModelConfiguration;
  readonly credentials: CredentialStore;
  readonly resolve?: (configuration: ModelConfiguration, role: string, credentials: CredentialStore) => Resolution;
  readonly timeoutMs?: number;
}

function uncertain(id: string, reason: DirectednessReason): DirectednessResult {
  return { type: "directedness_result", id, verdict: "uncertain", reason };
}

function parseVerdict(id: string, body: unknown): DirectednessResult {
  const text = (body as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> })
    .candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") return uncertain(id, "malformed-answer");
  try {
    const parsed = JSON.parse(text) as { verdict?: unknown; reason?: unknown };
    if (!VERDICTS.has(parsed.verdict as DirectednessVerdict)) return uncertain(id, "malformed-answer");
    if (!REASONS.has(parsed.reason as DirectednessReason)) return uncertain(id, "malformed-answer");
    return {
      type: "directedness_result",
      id,
      verdict: parsed.verdict as DirectednessVerdict,
      reason: parsed.reason as DirectednessReason,
    };
  } catch {
    return uncertain(id, "malformed-answer");
  }
}

export function createDirectednessClassifier(options: DirectednessClassifierOptions) {
  const resolve = options.resolve ?? resolveModel;
  const timeoutMs = options.timeoutMs ?? DIRECTEDNESS_TIMEOUT_MS;

  return async (request: DirectednessRequest): Promise<DirectednessResult> => {
    const resolution = resolve(options.configuration, "fast", options.credentials);
    if ("refusal" in resolution) return uncertain(request.id, "unconfigured");
    if (resolution.model.provider !== "google") return uncertain(request.id, "unsupported-provider");

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                'Determine only whether the speaker is addressing Mastra. Return strict JSON: {"verdict":"directed|incidental|uncertain","reason":"addressed-mastra|addressed-elsewhere|malformed-answer"}. Do not identify the speaker, authorize an action, or transcribe the utterance.',
            },
            { inlineData: { mimeType: "audio/pcm;rate=16000", data: request.audioBase64 } },
          ],
        },
      ],
      generationConfig: { responseMimeType: "application/json" },
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout(undefined), timeoutMs);
    });
    const answer = await Promise.race([resolution.model.send(body), timeout]);
    if (timer) clearTimeout(timer);
    if (!answer) return uncertain(request.id, "timeout");
    if (!answer.ok) return uncertain(request.id, "provider-refused");
    return parseVerdict(request.id, answer.body);
  };
}

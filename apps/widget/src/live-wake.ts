import { decideKeyword, overlappingWakeWindows, processLiveCapture, type KeywordDecision } from "@mastra-cc/voice";
import type { WakeKeywordModel } from "@mastra-cc/voice/node";

import type { FaceState } from "./hiding-model.js";
import { WIDGET_CAPTURE_FORMAT } from "./wake-adapters.js";

export const FROZEN_KEYWORD_THRESHOLD = 0.9999867081642151;

export async function decideWakeWindows(
  model: WakeKeywordModel | undefined,
  normalized: Int16Array,
  threshold = FROZEN_KEYWORD_THRESHOLD,
): Promise<KeywordDecision> {
  if (model === undefined) return decideKeyword(Number.NaN, threshold, "missing");
  const decisions: KeywordDecision[] = [];
  for (const window of overlappingWakeWindows(normalized)) {
    try {
      const confidence = await model.score(window);
      decisions.push(decideKeyword(confidence, threshold, Number.isFinite(confidence) ? "ready" : "corrupt"));
    } catch {
      decisions.push(decideKeyword(Number.NaN, threshold, "corrupt"));
    }
  }
  return decisions.find((decision) => decision.accepted) ?? decisions.reduce(
    (best, decision) => decision.confidence > best.confidence ? decision : best,
  );
}

export function createLiveWakeDetector(options: Readonly<{
  capture(signal?: AbortSignal): Promise<Buffer>;
  model: WakeKeywordModel;
  state(): FaceState;
  onDecision(result: KeywordDecision): void;
  onAccept(): void;
  threshold?: number;
}>) {
  let stopped = false;
  let unavailable = false;
  let pendingAdmission = false;
  let controller: AbortController | undefined;

  return {
    async runOnce(): Promise<KeywordDecision | undefined> {
      const state = options.state();
      if (stopped || unavailable || pendingAdmission || !state.armed || state.microphoneGateOpen) return undefined;
      controller = new AbortController();
      try {
        const raw = await options.capture(controller.signal);
        const normalized = processLiveCapture(raw, WIDGET_CAPTURE_FORMAT).normalized;
        const decision = await decideWakeWindows(options.model, normalized, options.threshold);
        options.onDecision(decision);
        if (decision.accepted) {
          pendingAdmission = true;
          options.onAccept();
        }
        return decision;
      } catch {
        unavailable = true;
        return undefined;
      } finally {
        controller = undefined;
      }
    },
    sessionStateChanged(): void {
      if (options.state().microphoneGateOpen) pendingAdmission = false;
    },
    availabilityChanged(): void {
      unavailable = false;
    },
    stop(): void {
      stopped = true;
      controller?.abort();
    },
  };
}

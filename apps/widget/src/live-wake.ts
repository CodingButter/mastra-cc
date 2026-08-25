import {
  UTTERANCE_FRAME_SAMPLES,
  advanceUtteranceEnd,
  createUtteranceEndState,
  decideKeyword,
  type KeywordDecision,
} from "@mastra-cc/voice";
import type { WakeKeywordModel } from "@mastra-cc/voice/node";

import type { FaceState } from "./hiding-model.js";
import { createProvisionalListening, type BufferedOpening, type ProvisionalMetadata } from "./provisional-listening.js";

export const FROZEN_KEYWORD_THRESHOLD = 0.99;
const WAKE_WINDOW_SAMPLES = 32_000;
const WAKE_STRIDE_SAMPLES = 8_000;

export async function decideWakeWindow(
  model: WakeKeywordModel | undefined,
  normalized: Int16Array,
  threshold = FROZEN_KEYWORD_THRESHOLD,
): Promise<KeywordDecision> {
  if (model === undefined) return decideKeyword(Number.NaN, threshold, "missing");
  try {
    const confidence = await model.score(normalized);
    return decideKeyword(confidence, threshold, Number.isFinite(confidence) ? "ready" : "corrupt");
  } catch {
    return decideKeyword(Number.NaN, threshold, "corrupt");
  }
}

function append(current: Int16Array, incoming: Int16Array): Int16Array {
  const next = new Int16Array(current.length + incoming.length);
  next.set(current);
  next.set(incoming, current.length);
  return next;
}

export function createLiveWakeDetector(options: Readonly<{
  model: WakeKeywordModel;
  state(): FaceState;
  onDecision(result: KeywordDecision): void;
  onOpening(opening: BufferedOpening): void;
  onMetadata(metadata: ProvisionalMetadata): void;
  threshold?: number;
}>) {
  const provisional = createProvisionalListening();
  let stopped = false;
  let unavailable = false;
  let evaluating = false;
  let pendingSamples: Int16Array = new Int16Array();
  let sinceLastScore = 0;
  let utterance = createUtteranceEndState();

  const evaluate = async () => {
    if (evaluating || pendingSamples.length < WAKE_WINDOW_SAMPLES) return;
    evaluating = true;
    try {
      while (!stopped && !unavailable && provisional.state() === "idle" && pendingSamples.length >= WAKE_WINDOW_SAMPLES) {
        const window = pendingSamples.slice(pendingSamples.length - WAKE_WINDOW_SAMPLES);
        const decision = await decideWakeWindow(options.model, window, options.threshold);
        options.onDecision(decision);
        sinceLastScore = 0;
        if (decision.accepted && provisional.wakeDetected(WAKE_WINDOW_SAMPLES)) {
          utterance = createUtteranceEndState();
          options.onMetadata(provisional.metadata());
          break;
        }
        if (pendingSamples.length > WAKE_WINDOW_SAMPLES) pendingSamples = pendingSamples.slice(-WAKE_WINDOW_SAMPLES);
        break;
      }
    } finally {
      evaluating = false;
    }
  };

  return {
    acceptSamples(samples: Int16Array): void {
      if (stopped || unavailable || !options.state().armed || options.state().microphoneGateOpen) return;
      provisional.push(samples);
      if (provisional.state() === "capturing-opening") {
        for (let offset = 0; offset < samples.length && !utterance.ended; offset += UTTERANCE_FRAME_SAMPLES) {
          utterance = advanceUtteranceEnd(utterance, samples.subarray(offset, offset + UTTERANCE_FRAME_SAMPLES));
        }
        if (utterance.ended) {
          const opening = provisional.finishOpening();
          options.onMetadata(provisional.metadata());
          options.onOpening(opening);
        }
        return;
      }
      if (provisional.state() !== "idle") return;
      pendingSamples = append(pendingSamples, samples);
      if (pendingSamples.length > WAKE_WINDOW_SAMPLES) pendingSamples = pendingSamples.slice(-WAKE_WINDOW_SAMPLES);
      sinceLastScore += samples.length;
      if (pendingSamples.length === WAKE_WINDOW_SAMPLES && sinceLastScore >= WAKE_STRIDE_SAMPLES) void evaluate();
    },
    captureFailed(reason = "capture-failed"): void {
      unavailable = true;
      provisional.captureFailed(reason);
      options.onMetadata(provisional.metadata());
    },
    admit(id: string): void {
      provisional.admit(id);
      options.onMetadata(provisional.metadata());
    },
    discard(reason: string): void {
      provisional.discard(reason);
      pendingSamples.fill(0);
      pendingSamples = new Int16Array();
      sinceLastScore = 0;
      options.onMetadata(provisional.metadata());
    },
    availabilityChanged(): void {
      unavailable = false;
    },
    stop(): void {
      stopped = true;
      provisional.discard("stopped");
      pendingSamples.fill(0);
      pendingSamples = new Int16Array();
    },
    provisionalState: provisional.state,
  };
}

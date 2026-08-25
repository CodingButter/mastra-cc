import { VOICE_CAPTURE_OPTIONS } from "@mastra-cc/voice";

export const PROVISIONAL_PRE_ROLL_SAMPLES = 8_000;
export const PROVISIONAL_MAX_SAMPLES = VOICE_CAPTURE_OPTIONS.sampleRate * 12;
const IDLE_RING_SAMPLES = VOICE_CAPTURE_OPTIONS.sampleRate * 2 + PROVISIONAL_PRE_ROLL_SAMPLES;

export type ProvisionalState = "idle" | "wake-detected" | "capturing-opening" | "awaiting-directedness" | "admitted" | "discarded";

export type BufferedOpening = Readonly<{
  audio: Int16Array;
  sampleRate: 16_000;
  channels: 1;
  sampleFormat: "s16le";
  startedAt: number;
  endedAt: number;
}>;

export type ProvisionalMetadata = Readonly<{
  state: ProvisionalState;
  startedAt?: number;
  endedAt?: number;
  sampleCount: number;
  durationMs: number;
  verdictId?: string;
}>;

function appendBounded(current: Int16Array, incoming: Int16Array, limit: number): Int16Array {
  if (incoming.length >= limit) return incoming.slice(incoming.length - limit);
  const retained = Math.min(current.length, limit - incoming.length);
  const next = new Int16Array(retained + incoming.length);
  next.set(current.subarray(current.length - retained));
  next.set(incoming, retained);
  return next;
}

export function createProvisionalListening(options: Readonly<{ now?: () => number }> = {}) {
  const now = options.now ?? Date.now;
  let phase: ProvisionalState = "idle";
  let ring: Int16Array = new Int16Array();
  let opening: Int16Array | undefined;
  let startedAt: number | undefined;
  let endedAt: number | undefined;
  let verdictId: string | undefined;

  const release = () => {
    opening?.fill(0);
    opening = undefined;
    ring.fill(0);
    ring = new Int16Array();
  };

  return {
    state: () => phase,
    push(samples: Int16Array): void {
      if (phase === "awaiting-directedness" || phase === "admitted" || phase === "discarded") return;
      ring = appendBounded(ring, samples, phase === "idle" ? IDLE_RING_SAMPLES : PROVISIONAL_MAX_SAMPLES);
    },
    wakeDetected(wakeWindowSamples: number): boolean {
      if (phase !== "idle") return false;
      phase = "wake-detected";
      startedAt = now();
      const retained = Math.min(ring.length, wakeWindowSamples + PROVISIONAL_PRE_ROLL_SAMPLES);
      ring = ring.slice(ring.length - retained);
      phase = "capturing-opening";
      return true;
    },
    finishOpening(): BufferedOpening {
      if (phase !== "capturing-opening") throw new Error("opening can finish only while provisional capture is active");
      endedAt = now();
      opening = ring.slice();
      ring.fill(0);
      ring = new Int16Array();
      phase = "awaiting-directedness";
      return {
        audio: opening,
        sampleRate: 16_000,
        channels: 1,
        sampleFormat: "s16le",
        startedAt: startedAt!,
        endedAt,
      };
    },
    admit(id: string): void {
      if (phase !== "awaiting-directedness") throw new Error("only a classified opening can be admitted");
      verdictId = id;
      phase = "admitted";
    },
    discard(id: string): void {
      verdictId = id;
      phase = "discarded";
      release();
      startedAt = undefined;
      endedAt = undefined;
      phase = "idle";
    },
    captureFailed(id: string): void {
      this.discard(id);
    },
    metadata(): ProvisionalMetadata {
      const sampleCount = opening?.length ?? ring.length;
      return {
        state: phase,
        startedAt,
        endedAt,
        sampleCount,
        durationMs: Math.round(sampleCount * 1_000 / VOICE_CAPTURE_OPTIONS.sampleRate),
        verdictId,
      };
    },
  };
}

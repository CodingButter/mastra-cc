export type OrchestratorSignalPriority = "urgent" | "normal" | "low";

export interface OrchestratorSignal {
  readonly id: string;
  readonly priority: OrchestratorSignalPriority;
  readonly detail: string;
}

export interface SignalBatch {
  readonly delivery: "automatic" | "user-turn";
  readonly signals: readonly OrchestratorSignal[];
}

export const SIGNAL_SILENCE_MS = 1_500;

export function createSignalScheduler(options: Readonly<{
  deliver(batch: SignalBatch): void;
  silenceMs?: number;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}> ) {
  const queued = new Map<string, OrchestratorSignal>();
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let speaking = false;
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelSilence = () => {
    if (silenceTimer === undefined) return;
    clearTimer(silenceTimer);
    silenceTimer = undefined;
  };

  const take = (priorities: ReadonlySet<OrchestratorSignalPriority>): OrchestratorSignal[] => {
    const batch: OrchestratorSignal[] = [];
    for (const [id, signal] of queued) {
      if (!priorities.has(signal.priority)) continue;
      batch.push(signal);
      queued.delete(id);
    }
    return batch;
  };

  const deliver = (priorities: ReadonlySet<OrchestratorSignalPriority>, delivery: SignalBatch["delivery"]) => {
    const signals = take(priorities);
    if (signals.length > 0) options.deliver({ delivery, signals });
  };

  const scheduleNormal = () => {
    cancelSilence();
    if (speaking || ![...queued.values()].some((signal) => signal.priority === "normal")) return;
    silenceTimer = setTimer(() => {
      silenceTimer = undefined;
      if (!speaking) deliver(new Set(["normal"]), "automatic");
    }, options.silenceMs ?? SIGNAL_SILENCE_MS);
  };

  return {
    enqueue(signal: OrchestratorSignal): void {
      if (queued.has(signal.id)) return;
      queued.set(signal.id, signal);
      if (signal.priority === "urgent" && !speaking) {
        cancelSilence();
        deliver(new Set(["urgent"]), "automatic");
        scheduleNormal();
      } else if (signal.priority === "normal") {
        scheduleNormal();
      }
    },

    modelSpeechStarted(): void {
      speaking = true;
      cancelSilence();
    },

    modelSpeechFinished(): void {
      speaking = false;
      deliver(new Set(["urgent"]), "automatic");
      scheduleNormal();
    },

    userTurn(): void {
      cancelSilence();
      deliver(new Set(["urgent", "normal", "low"]), "user-turn");
      scheduleNormal();
    },

    close(): void {
      cancelSilence();
      queued.clear();
    },
  };
}

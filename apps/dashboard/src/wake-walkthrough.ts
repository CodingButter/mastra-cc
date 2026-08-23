export type WakeTake = Readonly<{ slot: number; takeId: string }>;

export type WakeWalkthrough = Readonly<{
  phase: "idle" | "cue" | "countdown" | "capturing" | "ready" | "publishing" | "complete" | "error";
  takes: readonly WakeTake[];
  activeSlot: number;
  replaceSlot?: number;
  revision?: number;
  error?: string;
}>;

export type WakeWalkthroughEvent =
  | Readonly<{ type: "start" }>
  | Readonly<{ type: "cue-complete" }>
  | Readonly<{ type: "countdown-complete" }>
  | Readonly<{ type: "capture-complete"; takeId: string }>
  | Readonly<{ type: "rerecord"; slot: number }>
  | Readonly<{ type: "publish" }>
  | Readonly<{ type: "published"; revision: number }>
  | Readonly<{ type: "reset" }>
  | Readonly<{ type: "failed"; message: string }>;

export const initialWakeWalkthrough: WakeWalkthrough = { phase: "idle", takes: [], activeSlot: 0 };

export function advanceWakeWalkthrough(state: WakeWalkthrough, event: WakeWalkthroughEvent): WakeWalkthrough {
  if (event.type === "reset") return initialWakeWalkthrough;
  if (event.type === "failed") return { ...state, phase: "error", error: event.message };
  if (event.type === "start" && state.phase === "idle") return { ...state, phase: "cue" };
  if (event.type === "cue-complete" && state.phase === "cue") return { ...state, phase: "countdown" };
  if (event.type === "countdown-complete" && state.phase === "countdown") return { ...state, phase: "capturing" };
  if (event.type === "rerecord" && state.phase === "ready" && state.takes.some((take) => take.slot === event.slot)) {
    return { ...state, phase: "cue", activeSlot: event.slot, replaceSlot: event.slot };
  }
  if (event.type === "capture-complete" && state.phase === "capturing") {
    const next = [...state.takes.filter((take) => take.slot !== state.activeSlot), { slot: state.activeSlot, takeId: event.takeId }].sort(
      (left, right) => left.slot - right.slot,
    );
    if (state.replaceSlot !== undefined || next.length === 5) {
      return { phase: "ready", takes: next, activeSlot: Math.min(next.length, 4) };
    }
    return { phase: "cue", takes: next, activeSlot: state.activeSlot + 1 };
  }
  if (event.type === "publish" && state.phase === "ready" && state.takes.length === 5) {
    return { ...state, phase: "publishing" };
  }
  if (event.type === "published" && state.phase === "publishing") {
    return { ...state, phase: "complete", revision: event.revision };
  }
  return state;
}

import type { ControlMode, DemoEvent } from "./events";

export type Turn =
  | { kind: "you"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "notice"; text: string }
  | { kind: "tool"; callId: string; name: string; params: unknown; summary?: string }
  | { kind: "handover"; reason: string; requestId: string; answered: boolean };

export function reduceTurn(prior: Turn[], event: DemoEvent): Turn[] {
  const turns = [...prior];
  const last = turns[turns.length - 1];
  switch (event.type) {
    case "text":
      if (last?.kind === "agent") turns[turns.length - 1] = { ...last, text: last.text + event.text };
      else turns.push({ kind: "agent", text: event.text });
      return turns;
    case "tool":
      turns.push({ kind: "tool", callId: event.callId, name: event.name, params: event.params });
      return turns;
    case "tool-result": {
      const index = turns.findIndex(turn => turn.kind === "tool" && turn.callId === event.callId);
      const turn = turns[index];
      if (!turn || turn.kind !== "tool") {
        turns.push({ kind: "notice", text: `ignored result for unknown call ${event.callId}` });
      } else if (turn.summary !== undefined) {
        turns.push({ kind: "notice", text: `ignored duplicate result for call ${event.callId}` });
      } else if (turn.name !== event.name) {
        turns.push({ kind: "notice", text: `ignored mismatched result for call ${event.callId}` });
      } else {
        turns[index] = { ...turn, summary: event.summary };
      }
      return turns;
    }
    case "control":
      if (event.mode === "interact" && event.requestId) {
        turns.push({
          kind: "handover",
          reason: event.reason ?? "your turn",
          requestId: event.requestId,
          answered: false,
        });
      }
      return turns;
    case "error":
      turns.push({ kind: "notice", text: event.message });
      return turns;
    default:
      return turns;
  }
}

export function historyFromTurns(turns: Turn[]): Array<{ role: "user" | "assistant"; content: string }> {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const turn of turns) {
    if (turn.kind === "you") history.push({ role: "user", content: turn.text });
    if (turn.kind === "agent") history.push({ role: "assistant", content: turn.text });
  }
  return history;
}

export function overlayLabel(mode: ControlMode, busy: boolean): string | undefined {
  if (mode === "interact") return undefined;
  return busy ? "the agent is working — your input is blocked" : "view only — the agent holds the desk";
}

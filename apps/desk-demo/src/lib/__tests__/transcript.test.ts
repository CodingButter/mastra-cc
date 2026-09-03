import { describe, expect, it } from "vitest";
import { historyFromTurns, overlayLabel, reduceTurn, type Turn } from "../transcript";

describe("transcript", () => {
  it("preserves prose, tools, handovers, and notices", () => {
    let turns: Turn[] = [];
    turns = reduceTurn(turns, { type: "text", text: "hello" });
    turns = reduceTurn(turns, { type: "text", text: " world" });
    turns = reduceTurn(turns, { type: "tool", name: "queryElements", params: { role: "button" } });
    turns = reduceTurn(turns, { type: "tool-result", name: "queryElements", summary: "one" });
    turns = reduceTurn(turns, { type: "control", mode: "interact", requestId: "r1", reason: "sign in" });
    turns = reduceTurn(turns, { type: "error", message: "desk closed" });

    expect(turns).toEqual([
      { kind: "agent", text: "hello world" },
      { kind: "tool", name: "queryElements", params: { role: "button" }, summary: "one" },
      { kind: "handover", requestId: "r1", reason: "sign in", answered: false },
      { kind: "notice", text: "desk closed" },
    ]);
  });

  it("excludes notices and machinery from model history", () => {
    const turns: Turn[] = [
      { kind: "you", text: "do it" },
      { kind: "notice", text: "desk closed" },
      { kind: "tool", name: "x", params: {} },
      { kind: "agent", text: "done" },
    ];
    expect(historyFromTurns(turns)).toEqual([
      { role: "user", content: "do it" },
      { role: "assistant", content: "done" },
    ]);
  });

  it("labels idle view ownership differently from active work", () => {
    expect(overlayLabel("view", false)).toBe("view only — the agent holds the desk");
    expect(overlayLabel("view", true)).toBe("the agent is working — your input is blocked");
    expect(overlayLabel("interact", true)).toBeUndefined();
  });
});

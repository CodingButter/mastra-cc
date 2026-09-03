import { describe, expect, it } from "vitest";
import { historyFromTurns, overlayLabel, reduceTurn, type Turn } from "../transcript";

describe("transcript", () => {
  it("preserves prose, tools, handovers, and notices", () => {
    let turns: Turn[] = [];
    turns = reduceTurn(turns, { type: "text", text: "hello" });
    turns = reduceTurn(turns, { type: "text", text: " world" });
    turns = reduceTurn(turns, {
      type: "tool",
      callId: "call-1",
      name: "queryElements",
      params: { role: "button" },
    });
    turns = reduceTurn(turns, {
      type: "tool-result",
      callId: "call-1",
      name: "queryElements",
      summary: "one",
    });
    turns = reduceTurn(turns, { type: "control", mode: "interact", requestId: "r1", reason: "sign in" });
    turns = reduceTurn(turns, { type: "error", message: "desk closed" });

    expect(turns).toEqual([
      { kind: "agent", text: "hello world" },
      {
        kind: "tool",
        callId: "call-1",
        name: "queryElements",
        params: { role: "button" },
        summary: "one",
      },
      { kind: "handover", requestId: "r1", reason: "sign in", answered: false },
      { kind: "notice", text: "desk closed" },
    ]);
  });

  it("pairs overlapping same-name calls by call id in either result order", () => {
    let turns: Turn[] = [];
    turns = reduceTurn(turns, { type: "tool", callId: "a", name: "queryElements", params: { limit: 200 } });
    turns = reduceTurn(turns, { type: "tool", callId: "b", name: "queryElements", params: { limit: 1 } });
    turns = reduceTurn(turns, { type: "tool-result", callId: "b", name: "queryElements", summary: "fast" });
    turns = reduceTurn(turns, { type: "tool-result", callId: "a", name: "queryElements", summary: "slow" });

    expect(turns).toEqual([
      { kind: "tool", callId: "a", name: "queryElements", params: { limit: 200 }, summary: "slow" },
      { kind: "tool", callId: "b", name: "queryElements", params: { limit: 1 }, summary: "fast" },
    ]);
  });

  it("refuses unknown, duplicate, and name-mismatched results without corrupting calls", () => {
    let turns: Turn[] = [];
    turns = reduceTurn(turns, { type: "tool", callId: "a", name: "queryElements", params: {} });
    turns = reduceTurn(turns, { type: "tool-result", callId: "unknown", name: "queryElements", summary: "wrong" });
    turns = reduceTurn(turns, { type: "tool-result", callId: "a", name: "openApplication", summary: "wrong" });
    turns = reduceTurn(turns, { type: "tool-result", callId: "a", name: "queryElements", summary: "right" });
    turns = reduceTurn(turns, { type: "tool-result", callId: "a", name: "queryElements", summary: "overwrite" });

    expect(turns[0]).toEqual({
      kind: "tool",
      callId: "a",
      name: "queryElements",
      params: {},
      summary: "right",
    });
    expect(turns.slice(1)).toEqual([
      { kind: "notice", text: "ignored result for unknown call unknown" },
      { kind: "notice", text: "ignored mismatched result for call a" },
      { kind: "notice", text: "ignored duplicate result for call a" },
    ]);
  });

  it("excludes notices and machinery from model history", () => {
    const turns: Turn[] = [
      { kind: "you", text: "do it" },
      { kind: "notice", text: "desk closed" },
      { kind: "tool", callId: "call-1", name: "x", params: {} },
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

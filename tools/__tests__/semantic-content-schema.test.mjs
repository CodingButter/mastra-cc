import { describe, expect, it } from "vitest";
import { validateSemanticElement } from "../../packages/protocol-types/src/index.ts";

const element = (content) => ({
  id: "el-0123456789ab",
  role: "textbox",
  name: "Editor",
  states: ["enabled", "visible"],
  actions: [],
  content,
});

describe("semantic observable content", () => {
  it.each([
    { kind: "text", value: "ordinary text" },
    {
      kind: "text-window",
      value: "second line",
      offset: 11,
      length: 11,
      totalLength: 22,
      startLine: 2,
      endLine: 2,
      totalLines: 2,
    },
    { kind: "text-window", value: "bounded", offset: 100, length: 7, totalLength: 1000 },
    { kind: "number", value: 42 },
    { kind: "number", value: 42, range: { minimum: 0, maximum: 100, step: 1 } },
    { kind: "redacted", reason: "protected" },
    { kind: "unavailable", reason: "not-exposed" },
    { kind: "unavailable", reason: "unknown" },
  ])("accepts the $kind variant", (content) => {
    expect(validateSemanticElement(element(content))).toEqual([]);
  });

  it.each([
    { kind: "redacted", reason: "protected", value: "must-not-cross-the-wire" },
    { kind: "redacted", reason: "unknown" },
    { kind: "text", value: "ordinary text", reason: "protected" },
    { kind: "number", value: "42" },
    { kind: "unavailable", reason: "not-exposed", value: "invented" },
    { kind: "text-window", value: "abc", offset: 0, length: 2, totalLength: 3, startLine: 1, endLine: 1, totalLines: 1 },
    { kind: "text-window", value: "abc", offset: -1, length: 3, totalLength: 3, startLine: 1, endLine: 1, totalLines: 1 },
    { kind: "text-window", value: "abc", offset: 2, length: 3, totalLength: 4, startLine: 1, endLine: 1, totalLines: 1 },
    { kind: "text-window", value: "abc", offset: 0, length: 3, totalLength: 3, startLine: 2, endLine: 1, totalLines: 1 },
    { kind: "text-window", value: "abc", offset: 0, length: 3, totalLength: 3, startLine: 1 },
    { kind: "text-window", value: "abc", offset: 0, length: 3, totalLength: 3, startLine: 1, endLine: 1 },
    { kind: "atspi-text", value: "provider vocabulary" },
  ])("rejects malformed or ambiguous content %#", (content) => {
    expect(validateSemanticElement(element(content))).not.toEqual([]);
  });

  it("requires every semantic element to carry an explicit observation state", () => {
    const { content: _content, ...withoutContent } = element({ kind: "unavailable", reason: "unknown" });
    expect(validateSemanticElement(withoutContent)).toContain("semanticElement.content: required field is missing");
  });
});

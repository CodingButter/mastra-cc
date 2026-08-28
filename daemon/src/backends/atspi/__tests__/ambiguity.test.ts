import { describe, expect, it } from "vitest";
import type { SemanticElement } from "@mastra-cc/protocol-types";
import { resolveOne } from "../resolve.js";

// Ambiguity refuses and names every candidate; it never takes the first
// match. Nothing found means look again; two found means identity is unclear.

function element(id: string, name: string): SemanticElement {
  // "click" rather than the old invented "press": this is what a real button
  // published on a live session, and after schema version 1.4.0 an action is a
  // record carrying the element's own word plus whether it can be done now.
  return { id, role: "button", name, states: ["enabled", "visible"], content: { kind: "unavailable", reason: "not-exposed" }, actions: [{ name: "click", availability: "available" }] };
}

describe("single-target resolution", () => {
  it("two matching candidates produce a refusal naming both - never the first match", () => {
    const a = element("el-aaaaaaaaaaaa", "OK");
    const b = element("el-bbbbbbbbbbbb", "OK");
    const resolution = resolveOne([a, b], "OK");
    expect("element" in resolution).toBe(false);
    if ("refusal" in resolution) {
      expect(resolution.refusal).toContain("el-aaaaaaaaaaaa");
      expect(resolution.refusal).toContain("el-bbbbbbbbbbbb");
      expect(resolution.refusal).toContain("identity is unclear");
    }
  });

  it("zero matches produce a look-again refusal, not an empty success", () => {
    const resolution = resolveOne([], "a button that is not there");
    expect("element" in resolution).toBe(false);
    if ("refusal" in resolution) {
      expect(resolution.refusal).toContain("look again");
    }
  });

  it("exactly one match resolves to that element", () => {
    const only = element("el-cccccccccccc", "OK");
    const resolution = resolveOne([only], "OK");
    expect("element" in resolution && resolution.element.id).toBe("el-cccccccccccc");
  });
});

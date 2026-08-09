import { describe, expect, it } from "vitest";
import { nameMatches, normalise } from "../names.js";

// The mathematical-bold case from M0.5: a DM whose name used math-bold
// characters matched 0 of 30 with a plain comparison and exactly 1 after
// NFKC. "\u{1D40E}\u{1D40A}" is math-bold OK.

const MATH_BOLD_OK = "\u{1D40E}\u{1D40A}";

describe("NFKC name normalisation", () => {
  it("a mathematical-bold name matches its plain query after NFKC", () => {
    expect(nameMatches(MATH_BOLD_OK, "OK")).toBe(true);
  });

  it("and does NOT match without normalisation - the failure NFKC exists to prevent", () => {
    expect((MATH_BOLD_OK as string) === "OK").toBe(false);
    expect(MATH_BOLD_OK.includes("OK")).toBe(false);
  });

  it("normalises to the plain form", () => {
    expect(normalise(MATH_BOLD_OK)).toBe("OK");
  });

  it("matching is symmetric: a plain candidate matches a math-bold query too", () => {
    expect(nameMatches("OK", MATH_BOLD_OK)).toBe(true);
  });
});

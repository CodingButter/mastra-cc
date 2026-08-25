import { describe, expect, it } from "vitest";

import { decideKeyword } from "../index.js";

describe("phrase-only wake decision", () => {
  it("accepts and rejects keyword confidence without speaker input", () => {
    expect(decideKeyword(0.81, 0.8, "ready").accepted).toBe(true);
    expect(decideKeyword(0.79, 0.8, "ready").accepted).toBe(false);
  });

  it("fails closed for missing or corrupt models", () => {
    expect(decideKeyword(1, 0.8, "missing").accepted).toBe(false);
    expect(decideKeyword(1, 0.8, "corrupt").accepted).toBe(false);
  });

  it("fails closed for malformed scores and thresholds", () => {
    expect(decideKeyword(Number.NaN, 0.8, "ready").accepted).toBe(false);
    expect(decideKeyword(1.2, 0.8, "ready").accepted).toBe(false);
    expect(decideKeyword(1, Number.NaN, "ready").accepted).toBe(false);
  });
});

import { expect, test } from "vitest";
import { OBSERVE, refusesScope } from "../index.js";

test("every scope that is not observe is refused in M1", () => {
  expect(refusesScope("edit")).toBe(true);
  expect(refusesScope("activate")).toBe(true);
  expect(refusesScope("submit")).toBe(true);
});

test("observe itself is not refused", () => {
  expect(refusesScope(OBSERVE)).toBe(false);
});

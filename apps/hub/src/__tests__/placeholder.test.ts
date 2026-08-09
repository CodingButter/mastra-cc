import { expect, test } from "vitest";
import { formatElement } from "../index.js";

test("an element prints as role, quoted name, and id", () => {
  expect(formatElement("button", "OK", "el-0123456789ab")).toBe('button "OK" (el-0123456789ab)');
});

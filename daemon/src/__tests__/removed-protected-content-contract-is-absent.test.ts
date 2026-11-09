import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");

describe("protected content belongs to the agent-owned computer", () => {
  it("removes redacted/protected protocol content variants", () => {
    const schema = readFileSync(join(root, "protocol/schema.json"), "utf8");
    expect(schema).not.toContain('"name": "redacted"');
    expect(schema).not.toContain('"literal": "protected"');
  });
});

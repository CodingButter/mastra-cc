import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INSTRUCTIONS } from "../index.js";

// INSTRUCTIONS THAT LIVE ONLY IN THIS REPOSITORY ARE INSTRUCTIONS THE AGENT
// NEVER READS.
//
// The whole premise of the surface this package chose (primitives, not macros)
// is that the sequencing lives in prose the runtime installs: names are not
// identifiers, a returned call is not proof the desktop changed, a refusal is
// an answer. If the shipped copy drifts from the copy this repository reviews,
// the reviewed text stops being the text anyone runs on - so drift is a build
// failure, not a chore.

const shipped = fileURLToPath(new URL("../../instructions/AGENT-INSTRUCTIONS.md", import.meta.url));
const reviewed = fileURLToPath(new URL("../../../../docs/11-AGENT-INSTRUCTIONS.md", import.meta.url));

describe("the instructions", () => {
  it("are byte-identical to the ones this repository reviews", () => {
    const a = readFileSync(shipped);
    const b = readFileSync(reviewed);
    // Compared as BYTES: a trailing-newline or line-ending difference is drift
    // too, and a string comparison after normalisation would hide it.
    expect(a.equals(b)).toBe(true);
  });

  it("are what the package exports, not a summary of them", () => {
    expect(INSTRUCTIONS).toBe(readFileSync(shipped, "utf8"));
    expect(INSTRUCTIONS.length).toBeGreaterThan(1000);
  });
});

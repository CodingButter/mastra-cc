import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as pkg from "../index.js";

// INSTRUCTIONS THAT LIVE ONLY IN THIS REPOSITORY ARE INSTRUCTIONS THE AGENT
// NEVER READS.
//
// The whole premise of the surface this package chose (primitives, not macros)
// is that the sequencing lives in prose the runtime installs: names are not
// identifiers, a returned call is not proof the desktop changed, a refusal is
// an answer. If the shipped copy drifts from the copy this repository reviews,
// the reviewed text stops being the text anyone runs on - so drift is a build
// failure, not a chore.
//
// The table is DERIVED, from the package's own `exports` map, rather than
// written out here. A hardcoded list of three would keep passing on the day a
// fourth instruction file is added and shipped unguarded, which is the one
// failure this file exists to catch.

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { exports: Record<string, unknown> };

const docs = fileURLToPath(new URL("../../../../docs/", import.meta.url));

const shipped = Object.entries(manifest.exports)
  .filter(([subpath, target]) => subpath.startsWith("./instructions") && typeof target === "string")
  .map(([subpath, target]) => {
    const file = fileURLToPath(new URL(`../../${target as string}`, import.meta.url));
    const basename = (target as string).split("/").pop()!;
    // The reviewed copy carries a chapter number the shipped copy does not
    // ("11-AGENT-INSTRUCTIONS.md" against "AGENT-INSTRUCTIONS.md"), so it is
    // matched by suffix. Exactly one doc may claim each shipped file: two would
    // mean the reviewed text is ambiguous, which is its own kind of drift.
    const claims = readdirSync(docs).filter((name) => name.endsWith(`-${basename}`));
    return { subpath, file, basename, claims };
  });

describe("the instructions", () => {
  it("cover every instruction file the package exports", () => {
    // Guards the guard: were the exports map ever to stop naming them, every
    // assertion below would pass vacuously against an empty table.
    expect(shipped.length).toBeGreaterThanOrEqual(3);
  });

  for (const { subpath, file, basename, claims } of shipped) {
    describe(subpath, () => {
      it("has exactly one reviewed copy in docs", () => {
        expect(claims, `no docs/*-${basename} reviews the shipped ${basename}`).toHaveLength(1);
      });

      it("is byte-identical to the one this repository reviews", () => {
        const a = readFileSync(file);
        const b = readFileSync(`${docs}${claims[0]}`);
        // Compared as BYTES: a trailing-newline or line-ending difference is
        // drift too, and a string comparison after normalisation would hide it.
        expect(a.equals(b)).toBe(true);
      });

      it("is what the package exports, not a summary of it", () => {
        const text = readFileSync(file, "utf8");
        expect(text.length).toBeGreaterThan(1000);
        // Matched by VALUE rather than by a name spelled out here, so a file
        // that ships without any export at all fails instead of going unnoticed.
        const exported = Object.values(pkg).filter((value) => value === text);
        expect(exported, `${basename} ships but no export carries it`).toHaveLength(1);
      });
    });
  }
});

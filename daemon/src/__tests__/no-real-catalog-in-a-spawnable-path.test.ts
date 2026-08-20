import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Issue #20 regression guard. The offline suite must never pair the real
// CATALOG with a LaunchContext, because a launch context is a path to spawn:
// one deleted authority guard away from a real Chrome starting detached on
// the operator's signed-in Gmail profile. Tests that need the catalog's
// NAMES use DEFANGED_CATALOG (support/defanged-catalog.ts); tests that read
// the catalog's DATA (a recipe's env knob, its key list) may import CATALOG
// freely - data is not a spawn path, "catalog:" in a context literal is.
const HERE = dirname(fileURLToPath(import.meta.url));
const PAIRING = /catalog:\s*CATALOG\b/;

describe("the real catalog never reaches a spawnable path", () => {
  const files = readdirSync(HERE).filter((name) => name.endsWith(".test.ts"));

  it("scans a non-empty suite, or this guard passes vacuously", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("would recognise the pairing it guards against", () => {
    // The guard must be able to go red: the exact string a violation would
    // contain is matched here, so a drifted regex fails this test first.
    expect(PAIRING.test("catalog: " + "CATALOG,")).toBe(true);
    expect(PAIRING.test("catalog: DEFANGED_CATALOG,")).toBe(false);
  });

  it("no offline test pairs the real CATALOG with a launch context", () => {
    const offenders = files.filter((name) => PAIRING.test(readFileSync(join(HERE, name), "utf8")));
    expect(offenders).toEqual([]);
  });
});

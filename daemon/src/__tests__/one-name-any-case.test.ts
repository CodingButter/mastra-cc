import { describe, expect, it } from "vitest";
import type { Channel } from "../backends/atspi/channel.js";
import { AtspiBackend } from "../backends/atspi/index.js";
import { applicationName, nameMatches } from "../backends/atspi/names.js";
import { ReplayBackend } from "../backends/replay/index.js";
import { runningStateOf } from "../backend.js";
import { effectiveVisibility, isVisible } from "../grants.js";
import type { InventoryEntry } from "../inventory.js";
import type { LaunchCatalog } from "../launch/recipes.js";
import { findRecipe } from "../launch/spawn.js";
import { OwnershipTable } from "../launch/table.js";
import { AMBIGUOUS_NAME_REFUSAL, indexInventory, resolvePermitted } from "../server.js";

// ONE NAME, ANY CASE (ADR-0069).
//
// Measured 2026-09-02: Chromium registers on the accessibility bus as
// "Chromium" while its desktop entry, and so the operator's grant, reads
// "chromium". Under NFKC alone every layer that compares APPLICATION names
// walked past it. These tests pin the repaired rule at each layer the name
// crosses - grant, census, permit, ownership, catalog - and pin, just as hard,
// that ELEMENT names did not move: "OK" and "ok" on a screen are two labels.

const REGISTRY = "org.a11y.atspi.Registry";

// A scripted bus whose top level holds the named applications - the census
// reads names at the root and never descends.
function busHolding(names: string[]): Channel {
  const paths = names.map((_, index) => `/org/a11y/atspi/accessible/${index + 10}`);
  return {
    async call(exchange) {
      const { member, path, destination } = exchange;
      if (member === "GetChildren") return destination === REGISTRY ? [paths.map((p) => [":1.7", p])] : [[]];
      if (member === "Get") return [["s", [names[paths.indexOf(path)]]]];
      throw new Error(`unexpected ${member}`);
    },
    async watch() {
      throw new Error("not used");
    },
    async close() {},
  };
}

const EMPTY_CATALOG: LaunchCatalog = {};

describe("an application's name is the same name in any case", () => {
  it("T1: a grant for `yad` makes the application the bus calls `YAD` visible - and vice versa", async () => {
    // The gtk-dialog tape's application publishes itself as `yad`. An operator
    // who typed the grant in capitals meant the same application.
    const visibility = effectiveVisibility({ file: new Set(), flags: new Set(["YAD"]), permits: new Set() });
    expect(isVisible(visibility, "yad")).toBe(true);
    expect(isVisible(new Set(["yad"]), "YAD")).toBe(true);

    const backend = new ReplayBackend("gtk-dialog", visibility);
    const { elements } = await backend.queryElements({ role: "application" });
    await backend.close();
    expect(elements.map((e) => e.name)).toEqual(["yad"]);
  });

  it("T1b: folding widens nothing - an application nobody granted stays invisible in any case", async () => {
    // The gate did not move, only the comparison. A grant for some other
    // application does not reach `yad`, however either side is spelled.
    const visibility = effectiveVisibility({ file: new Set(), flags: new Set(["Kate"]), permits: new Set() });
    expect(isVisible(visibility, "yad")).toBe(false);
    expect(isVisible(visibility, "YAD")).toBe(false);

    const backend = new ReplayBackend("gtk-dialog", visibility);
    const { elements } = await backend.queryElements({});
    await backend.close();
    expect(elements).toEqual([]);
  });

  it("T0: applicationName() is NFKC then lowercase - and nothing more", () => {
    expect(applicationName("Chromium")).toBe("chromium");
    expect(applicationName("CHROMIUM")).toBe("chromium");
    // NFKC first: the fullwidth capital K folds to plain `k`, then lowercases.
    expect(applicationName("\uFF2Bate")).toBe("kate");
    expect(applicationName("ﬁrefox")).toBe("firefox"); // U+FB01 ligature -> "fi"
    // Not a locale-aware fold: dotted capital I stays distinct from `i`. Scope is stated in ADR-0069.
    expect(applicationName("\u0130")).not.toBe("i");
  });

  it("T2: the census reports the entry `chromium` answering when the bus says `Chromium`", async () => {
    const backend = new AtspiBackend(busHolding(["Chromium"]), "all");
    const census = await backend.runningApplications();
    expect(runningStateOf(census, applicationName("chromium"))).toBe("answering");
    // The census folds at the source, so the listing's derived candidates
    // (entry id `chromium`) meet it without knowing the bus's spelling.
    expect(census.observable.has("chromium")).toBe(true);
    expect(census.observable.has("Chromium")).toBe(false);
  });

  it("T3: a permit for `chromium` authorises `Chromium` and `CHROMIUM`", () => {
    const CHROMIUM: InventoryEntry = { name: "chromium", diagnostic: { "mastra-cc/display-name": "Chromium Web Browser" } };
    const index = indexInventory([CHROMIUM], EMPTY_CATALOG);
    const permits = new Set(["chromium"]);
    expect(resolvePermitted("Chromium", index, EMPTY_CATALOG, permits).kind).toBe("permitted");
    expect(resolvePermitted("CHROMIUM", index, EMPTY_CATALOG, permits).kind).toBe("permitted");
    // The permit SET is folded once at boot (grants.ts / main.ts), so the
    // operator's own spelling may be the capitalised one:
    const folded = effectiveVisibility({ file: new Set(), flags: new Set(), permits: new Set(["Chromium"]) });
    expect(resolvePermitted("chromium", index, EMPTY_CATALOG, folded as Set<string>).kind).toBe("permitted");
  });

  it("T4: an ownership record written as `Chromium` answers ownsName(`chromium`)", () => {
    const table = new OwnershipTable();
    table.record(process.pid, "Chromium");
    expect(table.ownsName("chromium")?.pid).toBe(process.pid);
    expect(table.ownsName("CHROMIUM")?.pid).toBe(process.pid);
  });

  it("T5: a catalog recipe keyed `Yad` is found for `yad`", () => {
    const catalog: LaunchCatalog = { Yad: { argv: ["yad"], env: {} } };
    expect(findRecipe("yad", catalog)).toBe(catalog.Yad);
    expect(findRecipe("YAD", catalog)).toBe(catalog.Yad);
  });

  it("T6: two entries whose ids differ only by case are one contested candidate, and refuse", () => {
    // Case-folding slots UNDER ADR-0068: it is what equality means, so a
    // Kate/kate pair is an ordinary ambiguity and authorises nothing.
    const upper: InventoryEntry = { name: "org.example.Kate", diagnostic: {} };
    const lower: InventoryEntry = { name: "org.example.kate", diagnostic: {} };
    const index = indexInventory([upper, lower], EMPTY_CATALOG);
    const permits = new Set(["kate", "org.example.kate", "org.example.Kate"]);
    for (const asked of ["kate", "Kate", "org.example.kate", "org.example.Kate"]) {
      const resolved = resolvePermitted(asked, index, EMPTY_CATALOG, permits);
      expect(resolved.kind, asked).toBe("ambiguous");
    }
    expect(AMBIGUOUS_NAME_REFUSAL).toMatch(/ambiguous|more than one/i);
  });

  it("T7 (pin): element names did NOT move - `ok` does not match the button `OK`", async () => {
    expect(nameMatches("OK", "ok")).toBe(false);
    expect(nameMatches("OK", "OK")).toBe(true);

    const backend = new ReplayBackend("gtk-dialog", new Set(["yad"]));
    const lower = await backend.queryElements({ name: "ok" });
    const exact = await backend.queryElements({ name: "OK" });
    await backend.close();
    expect(exact.elements.filter((e) => e.role === "button")).toHaveLength(1);
    expect(lower.elements.filter((e) => e.role === "button")).toHaveLength(0);
  });
});

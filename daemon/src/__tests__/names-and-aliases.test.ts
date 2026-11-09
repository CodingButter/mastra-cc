import { describe, expect, it } from "vitest";
import type { Channel } from "../backends/atspi/channel.js";
import { AtspiBackend } from "../backends/atspi/index.js";
import { applicationName, nameMatches } from "../backends/atspi/names.js";
import { ReplayBackend } from "../backends/replay/index.js";
import { InventoryUnsupportedError, runningStateOf, type Backend } from "../backend.js";
import type { InventoryEntry } from "../inventory.js";
import type { LaunchCatalog } from "../launch/recipes.js";
import { findRecipe } from "../launch/spawn.js";
import { OwnershipTable } from "../launch/table.js";
import { AMBIGUOUS_NAME_REFUSAL, handleRequest, indexInventory, resolveLaunchable, type LaunchContext } from "../server.js";

// ONE NAME, ANY CASE (ADR-0069).
//
// Measured 2026-09-02: Chromium registers on the accessibility bus as
// "Chromium" while its desktop entry reads "chromium". Under NFKC alone every
// layer that compares APPLICATION names walked past it. These tests pin the
// repaired rule at the census, ownership, and catalog/launch-name layers - and
// pin, just as hard,
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

const KATE: InventoryEntry = { name: "org.kde.kate", diagnostic: { "mastra-cc/display-name": "Kate" } };
const DECOY: InventoryEntry = { name: "vendor.fork.kate", diagnostic: { "mastra-cc/display-name": "Kate Fork" } };

function inventoryBackend(entries: InventoryEntry[] | "unsupported"): Backend {
  return {
    name: "alias-inventory",
    installedApplications: async () => {
      if (entries === "unsupported") throw new InventoryUnsupportedError("cannot enumerate");
      return entries;
    },
    runningApplications: async () => ({ observable: new Set<string>(), answersFor: new Set<string>() }),
    queryElements: async () => ({ elements: [] }),
    applicationOfElement: () => undefined,
    close: () => undefined,
  } as unknown as Backend;
}


describe("an application's name is the same name in any case", () => {


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
    const backend = new AtspiBackend(busHolding(["Chromium"]));
    const census = await backend.runningApplications();
    expect(runningStateOf(census, applicationName("chromium"))).toBe("answering");
    // The census folds at the source, so the listing's derived candidates
    // (entry id `chromium`) meet it without knowing the bus's spelling.
    expect(census.observable.has("chromium")).toBe(true);
    expect(census.observable.has("Chromium")).toBe(false);
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
    for (const asked of ["kate", "Kate", "org.example.kate", "org.example.Kate"]) {
      const resolved = resolveLaunchable(asked, index, EMPTY_CATALOG);
      expect(resolved.kind, asked).toBe("ambiguous");
    }
    expect(AMBIGUOUS_NAME_REFUSAL).toMatch(/ambiguous|more than one/i);
  });

  it("T7 (pin): element names did NOT move - `ok` does not match the button `OK`", async () => {
    expect(nameMatches("OK", "ok")).toBe(false);
    expect(nameMatches("OK", "OK")).toBe(true);

    const backend = new ReplayBackend("gtk-dialog");
    const lower = await backend.queryElements({ name: "ok" });
    const exact = await backend.queryElements({ name: "OK" });
    await backend.close();
    expect(exact.elements.filter((e) => e.role === "button")).toHaveLength(1);
    expect(lower.elements.filter((e) => e.role === "button")).toHaveLength(0);
  });
});


describe("one inventory entry may have several unprivileged names", () => {
  it("keeps exact full ids resolvable while a shared short name is ambiguous", () => {
    const catalog: LaunchCatalog = {
      "org.kde.kate": { argv: ["sleep", "30"], env: {} },
      "vendor.fork.kate": { argv: ["sleep", "30"], env: {} },
    };
    const index = indexInventory([KATE, DECOY], catalog);
    expect(resolveLaunchable("kate", index, catalog).kind).toBe("ambiguous");
    expect(resolveLaunchable("org.kde.kate", index, catalog).kind).toBe("launchable");
    expect(resolveLaunchable("vendor.fork.kate", index, catalog).kind).toBe("launchable");
  });

  it("does not make a sibling id ambiguous merely because recipes share appearsAs", () => {
    const catalog: LaunchCatalog = {
      chrome: { argv: ["sleep", "30"], env: {}, appearsAs: "chrome" },
      gmail: { argv: ["sleep", "30"], env: {}, appearsAs: "chrome" },
    };
    const index = indexInventory([], catalog);
    expect(resolveLaunchable("gmail", index, catalog).kind).toBe("launchable");
    expect(resolveLaunchable("chrome", index, catalog).kind).toBe("launchable");
  });

  it("degrades an unread inventory to an exact catalog check", () => {
    const catalog: LaunchCatalog = { "org.kde.kate": { argv: ["sleep", "30"], env: {} } };
    expect(resolveLaunchable("org.kde.kate", undefined, catalog).kind).toBe("launchable");
    expect(resolveLaunchable("kate", undefined, catalog).kind).toBe("unlaunchable");
  });

  it("returns AMBIGUOUS_NAME_REFUSAL over the wire and records no owned spawn", async () => {
    const table = new OwnershipTable();
    const launch: LaunchContext = {
      catalog: { "org.kde.kate": { argv: ["sleep", "30"], env: {} } },
      table,
      pollBudgetMs: 20,
      pollIntervalMs: 5,
    };
    const answer = await handleRequest(
      { type: "request", id: 1, method: "openApplication", params: { name: "kate" } },
      inventoryBackend([KATE, DECOY]),
      launch,
    );
    expect((answer.result as { refusal?: { message: string } }).refusal?.message).toBe(AMBIGUOUS_NAME_REFUSAL);
    expect(table.entries()).toEqual([]);
  });

  it("acts on an entry full id when requested through its uncontested short name", async () => {
    const table = new OwnershipTable();
    const launch: LaunchContext = {
      catalog: { "org.kde.kate": { argv: ["sleep", "30"], env: {} } },
      table,
      pollBudgetMs: 20,
      pollIntervalMs: 5,
    };
    const answer = await handleRequest(
      { type: "request", id: 1, method: "openApplication", params: { name: "kate" } },
      inventoryBackend([KATE]),
      launch,
    );
    expect((answer.result as { refusal?: string }).refusal).not.toBe(AMBIGUOUS_NAME_REFUSAL);
    expect(table.ownsName("org.kde.kate")).toBeDefined();
    for (const entry of table.entries()) {
      try { process.kill(entry.pid, "SIGTERM"); } catch {}
    }
  });
});

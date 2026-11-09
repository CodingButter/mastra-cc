import { refusalText } from "./refusal-text.js";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { InstalledApplication } from "@mastra-cc/protocol-types";
import { InventoryUnsupportedError, type Backend } from "../backend.js";
import { desktopEntryDirectories, scanInstalledApplications } from "../inventory.js";
import { baseLaunchCatalog, deriveLaunchCatalog } from "../launch/derived.js";
import {
  MalformedProfilesFileError,
  composeCatalog,
  loadProfilesFile,
} from "../launch/profiles.js";
import { CATALOG, type LaunchCatalog } from "../launch/recipes.js";
import { NO_RECIPE_REFUSAL, findRecipe } from "../launch/spawn.js";
import { OwnershipTable } from "../launch/table.js";
import {
  ONE_BROWSER_IDENTITY_REFUSAL,
  NO_LAUNCH_RECIPE_REFUSAL,
  capabilityExposureFor,
  handleRequest,
  type LaunchContext,
} from "../server.js";
import { defang } from "./support/defanged-catalog.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// ANY APP THE MACHINE HAS (ADR-0062).
//
// The catalog is now the machine's own catalog with the hand-written recipes
// overlaid on top. What that changes is CAPABILITY: openApplication can name
// an application this machine actually provides. What it does not change is
// AUTHORITY - a launch still needs a permit, an unlaunchable name still refuses
// byte-identically to an unknown one, and the built-in browser identities can
// never be displaced by a file on disk.
//
// Every catalog that reaches a LaunchContext here is DEFANGED. A derived
// catalog's blast radius is every application installed on the machine running
// these tests, which is strictly worse than the signed-in Chrome that produced
// this discipline (issue #20).

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "..", "..", "fixtures", "desktop-entries");
const FIXTURE_DIRECTORIES = [
  join(FIXTURE, "home", "applications"),
  join(FIXTURE, "system", "applications"),
  join(FIXTURE, "second", "applications"),
];

// The exact composition main.ts performs at boot - the shipping expression,
// not a paraphrase of it.
function composedBase(directories: string[] = FIXTURE_DIRECTORIES): LaunchCatalog {
  return baseLaunchCatalog(directories);
}

function launch(overrides: Partial<LaunchContext>): LaunchContext {
  return {
    catalog: defang(composedBase()),
    table: new OwnershipTable(),
    pollBudgetMs: 60,
    pollIntervalMs: 10,
    ...overrides,
  };
}

function inventoryBackend(directories: string[] = FIXTURE_DIRECTORIES): Backend {
  return {
    name: "fixture-inventory",
    ...observeOnlyEffects,
    installedApplications: async () => scanInstalledApplications(directories),
    queryElements: async () => ({ elements: [] }),
    attestElement: async () => ({}),
    applicationOfElement: () => undefined,
    close: () => undefined,
  } as unknown as Backend;
}

async function open(name: string, context: LaunchContext) {
  const answer = await handleRequest(
    { type: "request", id: 1, method: "openApplication", params: { name } },
    inventoryBackend(),
    context,
  );
  return answer.result as { refusal?: string };
}

async function listing(context: LaunchContext, directories: string[] = FIXTURE_DIRECTORIES) {
  const answer = await handleRequest(
    { type: "request", id: 1, method: "listApplications", params: {} },
    inventoryBackend(directories),
    context,
  );
  return answer.result as { applications: InstalledApplication[] };
}

describe("the machine's own catalog", () => {
  it("the fixture derives something before anything else is asserted about it", () => {
    expect(Object.keys(deriveLaunchCatalog(FIXTURE_DIRECTORIES))).toContain("ordinary");
  });

  it("an application the machine has is launchable, and one with no Exec is not", async () => {
    const { applications } = await listing(launch({}));
    const ordinary = applications.find((application) => application.name === "ordinary");
    expect(ordinary?.launchable).toBe(true);
    // An installed application whose entry says nothing about how to start it
    // is honestly not launchable - the same answer it gave before this change.
    const directory = mkdtempSync(join(tmpdir(), "mastra-cc-no-exec-"));
    writeFileSync(join(directory, "silent.desktop"), "[Desktop Entry]\nType=Application\nName=Silent\n");
    const silent = (await listing(launch({ catalog: defang(composedBase([directory])) }), [directory])).applications.find(
      (application) => application.name === "silent",
    );
    expect(silent).toBeDefined();
    expect(silent?.launchable).toBe(false);
  });

  it("launch capability is no longer not-exposed for an installed application", () => {
    const state = capabilityExposureFor(launch({}), "launch", "ordinary");
    expect(state.availability).not.toBe("not-exposed");
    // ...and a name nothing provides still has no path at all.
    expect(capabilityExposureFor(launch({}), "launch", "zz-no-such-app").availability).toBe("not-exposed");
  });

  it("an installed name the enumerated machine does not claim refuses at the gate, byte-identically to unlaunchable", async () => {
    // The inventory WAS read and nothing on it answers to this name. The
    // refusal is the same constant an unlaunchable name gets; it discloses no
    // incidental inventory detail beyond the missing launch recipe.
    const context = launch({});
    const answer = await open("zz-no-such-app", context);
    expect(refusalText(answer)).toBe(NO_LAUNCH_RECIPE_REFUSAL);
  });

  it("a launchable derived name reaches the launch path", async () => {
    const context = launch({});
    const answer = await open("ordinary", context);
    // Defanged argv is a sleep, so nothing observable ever appears: the answer
    // is the honest "opened but did not become readable", NOT either refusal
    // that would mean the name was turned away before spawning.
    expect(refusalText(answer)).not.toBe(NO_LAUNCH_RECIPE_REFUSAL);
    expect(refusalText(answer)).not.toBe(NO_RECIPE_REFUSAL);
  });

  it("two derived applications over one binary are not competing browser identities", async () => {
    // The machine routinely puts several desktop entries over one executable -
    // libreoffice-writer and libreoffice-calc both run `libreoffice`, so they
    // share an appearsAs. The one-browser-identity guard (ADR-0038) is about
    // the debugging endpoint those two contend for nothing of, and a guard
    // keyed on tree names alone would refuse the second one outright.
    const directory = mkdtempSync(join(tmpdir(), "mastra-cc-siblings-"));
    writeFileSync(
      join(directory, "office-writer.desktop"),
      "[Desktop Entry]\nType=Application\nName=Writer\nExec=officesuite --writer\n",
    );
    writeFileSync(
      join(directory, "office-calc.desktop"),
      "[Desktop Entry]\nType=Application\nName=Calc\nExec=officesuite --calc\n",
    );
    const catalog = defang(composedBase([directory]));
    expect(catalog["office-writer"]?.appearsAs).toBe(catalog["office-calc"]?.appearsAs);
    const table = new OwnershipTable();
    table.record(process.pid, "office-writer"); // a live sibling of ours
    const context = launch({ catalog, table });
    try {
      const answer = await open("office-calc", context);
      expect(refusalText(answer)).not.toBe(ONE_BROWSER_IDENTITY_REFUSAL);
    } finally {
      for (const entry of table.entries()) {
        if (entry.pid === process.pid) continue;
        try {
          process.kill(entry.pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  });

  it("a derived entry cannot displace the built-in browser identities", () => {
    const directory = mkdtempSync(join(tmpdir(), "mastra-cc-shadow-"));
    writeFileSync(
      join(directory, "chrome.desktop"),
      "[Desktop Entry]\nType=Application\nName=Impostor\nExec=/usr/bin/impostor\n",
    );
    // NFKC form: "ｃhrome" with a fullwidth c normalises to "chrome", so a
    // spread on normalised keys must still land under the built-in.
    writeFileSync(
      join(directory, "\uFF43hrome.desktop"),
      "[Desktop Entry]\nType=Application\nName=Impostor Two\nExec=/usr/bin/impostor-two\n",
    );
    writeFileSync(
      join(directory, "gmail.desktop"),
      "[Desktop Entry]\nType=Application\nName=Impostor Three\nExec=/usr/bin/impostor-three\n",
    );
    const composed = composedBase([directory]);
    expect(composed.chrome?.argv).toEqual(CATALOG.chrome?.argv);
    expect(composed.gmail?.argv).toEqual(CATALOG.gmail?.argv);
    expect(findRecipe("chrome", composed)?.argv).toEqual(CATALOG.chrome?.argv);
  });

  it("browser profiles still compose from the built-in browser recipe", () => {
    const composed = composeCatalog(composedBase(), [
      { name: "chrome-work", directory: "/tmp/mastra-cc-profile-work" },
    ]);
    const work = composed["chrome-work"];
    const chrome = CATALOG.chrome as { argv: readonly string[] };
    expect(work?.argv.filter((argument) => !argument.startsWith("--user-data-dir="))).toEqual(
      chrome.argv.filter((argument) => !argument.startsWith("--user-data-dir=")),
    );
    expect(work?.argv).toContain("--user-data-dir=/tmp/mastra-cc-profile-work");
    // The base entry is untouched.
    expect(composed.chrome?.argv).toEqual(chrome.argv);
  });

  it("a profile cannot silently shadow an application the machine provides", () => {
    const directory = mkdtempSync(join(tmpdir(), "mastra-cc-profiles-"));
    const shadowsDerived = join(directory, "derived.json");
    writeFileSync(
      shadowsDerived,
      JSON.stringify({ browserProfiles: [{ name: "ordinary", directory: "/tmp/mastra-cc-profile-ordinary" }] }),
    );
    expect(() => loadProfilesFile(shadowsDerived, composedBase())).toThrow(MalformedProfilesFileError);
    // The built-in collision refuses as it always did, with its own message.
    const shadowsBuiltIn = join(directory, "built-in.json");
    writeFileSync(
      shadowsBuiltIn,
      JSON.stringify({ browserProfiles: [{ name: "gmail", directory: "/tmp/mastra-cc-profile-gmail" }] }),
    );
    expect(() => loadProfilesFile(shadowsBuiltIn, composedBase())).toThrow(
      /already a built-in launch recipe/,
    );
  });



  it("boot survives a machine with no entries at all", () => {
    const empty = deriveLaunchCatalog([join(tmpdir(), "mastra-cc-does-not-exist-ever")]);
    expect(empty).toEqual({});
    expect(Object.keys({ ...empty, ...CATALOG }).sort()).toEqual(Object.keys(CATALOG).sort());
  });

  it("nothing about the filesystem reaches the wire", async () => {
    const serialised = JSON.stringify(await listing(launch({})));
    expect(serialised).not.toContain("/usr/bin");
    expect(serialised).not.toContain("/home/example");
    expect(serialised).not.toContain("Exec");
    expect(serialised).not.toContain(".desktop");
  });

  it("the derived catalog is never read on a request path - it is boot data", () => {
    // desktopEntryDirectories is what main.ts hands the derivation once; the
    // server module never derives anything itself.
    expect(desktopEntryDirectories({ HOME: "/home/example" }).length).toBeGreaterThan(0);
    const server = readFileSync(join(here, "..", "server.ts"), "utf8");
    expect(server).not.toContain("deriveLaunchCatalog");
  });
});


describe("the desktop entry scan remains complete", () => {
  it("records NoDisplay and Hidden entries instead of dropping installed applications", () => {
    const found = scanInstalledApplications(FIXTURE_DIRECTORIES);
    expect(found.find((entry) => entry.name === "hidden-from-menus")?.diagnostic).toMatchObject({
      "mastra-cc/menu-visibility": "no-display",
    });
    expect(found.find((entry) => entry.name === "withdrawn")?.diagnostic).toMatchObject({
      "mastra-cc/menu-visibility": "hidden",
    });
  });

  it("excludes desktop entries whose Type is not Application", () => {
    expect(scanInstalledApplications(FIXTURE_DIRECTORIES).map((entry) => entry.name)).not.toContain("not-an-application");
  });

  it("surfaces two entries sharing a display name as distinct applications", () => {
    const found = scanInstalledApplications(FIXTURE_DIRECTORIES).filter(
      (entry) => entry.diagnostic?.["mastra-cc/display-name"] === "Same Display Name",
    );
    expect(found.map((entry) => entry.name).sort()).toEqual(["collide-one", "collide-two"]);
  });

  it("skips a malformed entry while preserving its neighbours", () => {
    const names = scanInstalledApplications(FIXTURE_DIRECTORIES).map((entry) => entry.name);
    expect(names).not.toContain("malformed");
    expect(names).toContain("ordinary");
  });

  it("honours XDG directory precedence", () => {
    const found = scanInstalledApplications(FIXTURE_DIRECTORIES);
    expect(found.filter((entry) => entry.name === "ordinary")).toHaveLength(1);
    expect(found.find((entry) => entry.name === "ordinary")?.diagnostic?.["mastra-cc/display-name"]).toBe(
      "Ordinary (home copy)",
    );
    const reversed = scanInstalledApplications([...FIXTURE_DIRECTORIES].reverse());
    expect(reversed.find((entry) => entry.name === "ordinary")?.diagnostic?.["mastra-cc/display-name"]).toBe(
      "Ordinary (second system copy)",
    );
  });

  it("uses XDG_DATA_HOME and XDG_DATA_DIRS with specification defaults", () => {
    expect(desktopEntryDirectories({ HOME: "/home/example" })).toEqual([
      "/home/example/.local/share/applications",
      "/usr/local/share/applications",
      "/usr/share/applications",
    ]);
    expect(desktopEntryDirectories({ XDG_DATA_HOME: "/data/home", XDG_DATA_DIRS: "/data/one:/data/two" })).toEqual([
      "/data/home/applications",
      "/data/one/applications",
      "/data/two/applications",
    ]);
  });

  it("does not expose paths or command lines from the scan", () => {
    const serialised = JSON.stringify(scanInstalledApplications(FIXTURE_DIRECTORIES));
    expect(serialised).not.toContain("/usr/bin");
    expect(serialised).not.toContain("Exec");
    expect(serialised).not.toContain(FIXTURE);
  });

  it("lists every recipe-only application once and merges installed recipes without duplication", async () => {
    const withoutYadEntry = [join(FIXTURE, "home", "applications")];
    const recipeOnly = (await listing(launch({}), withoutYadEntry)).applications;
    expect(scanInstalledApplications(withoutYadEntry).map((entry) => entry.name)).not.toContain("yad");
    expect(recipeOnly.filter((entry) => entry.name === "yad")).toHaveLength(1);
    const merged = (await listing(launch({}))).applications;
    expect(merged.filter((entry) => entry.name === "yad")).toHaveLength(1);
  });

  it("refuses by name when the backend cannot enumerate applications", async () => {
    const backend = {
      ...inventoryBackend(),
      installedApplications: async () => {
        throw new InventoryUnsupportedError("this route cannot look");
      },
    } as unknown as Backend;
    const answer = await handleRequest(
      { type: "request", id: 1, method: "listApplications", params: {} },
      backend,
      launch({}),
    );
    expect(refusalText(answer.result)).toContain("cannot enumerate what this machine has installed");
  });
});

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITY_NAMES, type InstalledApplication, type SemanticElement } from "@mastra-cc/protocol-types";
import { InventoryUnsupportedError, type Backend } from "../backend.js";
import { desktopEntryDirectories, scanInstalledApplications } from "../inventory.js";
import { loadCapabilitiesFile, WITHHOLDS_NOTHING } from "../capabilities.js";
import { CATALOG } from "../launch/recipes.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";
import { OwnershipTable } from "../launch/table.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  LIST_APPLICATIONS_REFUSAL,
  UNAVAILABLE_REFUSAL,
  capabilityStateFor,
  handleRequest,
  type LaunchContext,
} from "../server.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// EXISTENCE IS READABLE (ADR-0042).
//
// The reversal this milestone exists for. Under M2, an application this
// session could not touch was ABSENT from every answer, and the proof of that
// behaviour is still on disk (docs/proofs/an-unpermitted-application-is-
// invisible.md) as the accurate record of what M2 shipped. This file pins the
// opposite contract: the application is PRESENT, its capabilities are reported
// one by one, and every capability that is off names the setting that would
// turn it on.
//
// What did NOT change is the fence. Nothing here reads inside an application,
// and every effect-class verb is still refused before the call.

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "..", "..", "fixtures", "desktop-entries");
const dir = mkdtempSync(join(tmpdir(), "mastra-cc-inventory-"));

// The fixture's directories in XDG precedence order: the user's own first,
// then the two system ones. Passing them explicitly is what keeps this suite
// off the machine it runs on.
const FIXTURE_DIRECTORIES = [
  join(FIXTURE, "home", "applications"),
  join(FIXTURE, "system", "applications"),
  join(FIXTURE, "second", "applications"),
];

describe("the desktop entry scan", () => {
  // Every assertion below is about WHICH entries came back, so a scan that
  // silently returned nothing would satisfy most of them vacuously. This one
  // fails first if the fixture ever stops being read at all.
  it("the fixture is non-empty before anything is asserted about its contents", () => {
    const found = scanInstalledApplications(FIXTURE_DIRECTORIES);
    expect(found.length).toBeGreaterThan(0);
    expect(found.map((entry) => entry.name)).toContain("ordinary");
  });

  it("an entry a menu hides is still installed - NoDisplay and Hidden are recorded, never dropped", () => {
    const found = scanInstalledApplications(FIXTURE_DIRECTORIES);
    const names = found.map((entry) => entry.name);
    expect(names).toContain("hidden-from-menus");
    expect(names).toContain("withdrawn");
    // Recorded, and recorded as what it is: a statement about menus.
    expect(found.find((entry) => entry.name === "hidden-from-menus")?.diagnostic).toMatchObject({
      "mastra-cc/menu-visibility": "no-display",
    });
    expect(found.find((entry) => entry.name === "withdrawn")?.diagnostic).toMatchObject({
      "mastra-cc/menu-visibility": "hidden",
    });
  });

  it("a Type that is not Application is not reported as an application", () => {
    const names = scanInstalledApplications(FIXTURE_DIRECTORIES).map((entry) => entry.name);
    expect(names).not.toContain("not-an-application");
  });

  it("two entries sharing a display name both surface, distinguishably", () => {
    const found = scanInstalledApplications(FIXTURE_DIRECTORIES);
    const colliding = found.filter((entry) => entry.diagnostic?.["mastra-cc/display-name"] === "Same Display Name");
    expect(colliding.map((entry) => entry.name).sort()).toEqual(["collide-one", "collide-two"]);
  });

  it("a malformed entry is skipped and its neighbours survive", () => {
    const found = scanInstalledApplications(FIXTURE_DIRECTORIES);
    expect(found.map((entry) => entry.name)).not.toContain("malformed");
    // The file sorts between collide-two and not-an-application, so a scan
    // that aborted on it would lose the entries after it in that directory.
    expect(found.map((entry) => entry.name)).toContain("ordinary");
  });

  it("XDG precedence is honoured - the user's copy shadows the system ones", () => {
    const found = scanInstalledApplications(FIXTURE_DIRECTORIES);
    const ordinary = found.filter((entry) => entry.name === "ordinary");
    expect(ordinary).toHaveLength(1);
    expect(ordinary[0]?.diagnostic?.["mastra-cc/display-name"]).toBe("Ordinary (home copy)");

    // Reversing the order reverses the winner: the precedence is being read
    // from the directory list, not from a happy accident of file contents.
    const reversed = scanInstalledApplications([...FIXTURE_DIRECTORIES].reverse());
    expect(reversed.find((entry) => entry.name === "ordinary")?.diagnostic?.["mastra-cc/display-name"]).toBe(
      "Ordinary (second system copy)",
    );
  });

  it("the directory list follows XDG_DATA_HOME and XDG_DATA_DIRS, with the specification's defaults", () => {
    expect(desktopEntryDirectories({ HOME: "/home/example" })).toEqual([
      "/home/example/.local/share/applications",
      "/usr/local/share/applications",
      "/usr/share/applications",
    ]);
    expect(
      desktopEntryDirectories({ XDG_DATA_HOME: "/data/home", XDG_DATA_DIRS: "/data/one:/data/two" }),
    ).toEqual(["/data/home/applications", "/data/one/applications", "/data/two/applications"]);
  });

  it("nothing that leaves the scan names a path or a command line", () => {
    const found = scanInstalledApplications(FIXTURE_DIRECTORIES);
    const serialised = JSON.stringify(found);
    expect(serialised).not.toContain("/usr/bin");
    expect(serialised).not.toContain("Exec");
    expect(serialised).not.toContain(FIXTURE);
  });
});

// A backend that answers the fixture inventory and observes nothing else. The
// listing is the only thing under test here, so everything else throws.
function inventoryBackend(entries = FIXTURE_DIRECTORIES): Backend {
  return {
    name: "fixture-inventory",
    ...observeOnlyEffects,
    installedApplications: async () => scanInstalledApplications(entries),
    queryElements: async () => ({ elements: [] }),
    attestElement: async () => ({}),
    subscribeElement: async () => {
      throw new Error("the listing touched the change stream");
    },
    unsubscribeElement: async () => undefined,
    applicationOfElement: () => undefined,
    close: () => undefined,
  } as unknown as Backend;
}

function context(overrides: Partial<LaunchContext> = {}): LaunchContext {
  return { permits: new Set(), catalog: DEFANGED_CATALOG, table: new OwnershipTable(), ...overrides };
}

async function listing(launch: LaunchContext, backend: Backend = inventoryBackend()): Promise<InstalledApplication[]> {
  const answer = await handleRequest({ type: "request", id: 1, method: "listApplications", params: {} }, backend, launch);
  // listApplications is observe-class, so its refusal (when there is one) is
  // part of the RESULT, exactly as the schema's ListApplicationsResult says.
  const result = answer.result as { applications?: InstalledApplication[]; refusal?: string };
  expect(result.refusal).toBeUndefined();
  const applications = result.applications;
  expect(applications).toBeDefined();
  return applications as InstalledApplication[];
}

function capabilityOf(application: InstalledApplication, name: string) {
  return application.capabilities.find((capability) => capability.capability === name);
}

describe("the application listing", () => {
  it("an application this session may not touch is PRESENT, with its capabilities off", async () => {
    const applications = await listing(context());
    const ordinary = applications.find((application) => application.name === "ordinary");
    expect(ordinary).toBeDefined();
    // Present, and off: the reversal is that both halves are true at once.
    expect(capabilityOf(ordinary as InstalledApplication, "observe")?.availability).toBe("disabled-by-configuration");
    expect(capabilityOf(ordinary as InstalledApplication, "edit")?.availability).toBe("disabled-by-configuration");
  });

  it("every capability the contract defines is present, always all of them", async () => {
    const applications = await listing(context());
    expect(applications.length).toBeGreaterThan(0);
    for (const application of applications) {
      expect(application.capabilities.map((capability) => capability.capability)).toEqual([...CAPABILITY_NAMES]);
    }
  });

  it("a capability that is off NAMES the setting that would turn it on", async () => {
    const applications = await listing(context());
    for (const application of applications) {
      for (const capability of application.capabilities) {
        if (capability.availability !== "disabled-by-configuration") continue;
        // The whole point of ADR-0042: a refusal a person cannot act on is a
        // wall, not an answer.
        expect(capability.disabledBy).toBeTruthy();
      }
    }
    const ordinary = applications.find((application) => application.name === "ordinary") as InstalledApplication;
    expect(capabilityOf(ordinary, "observe")?.disabledBy).toContain("--grants");
    expect(capabilityOf(ordinary, "edit")?.disabledBy).toContain("--allow edit");
    // Launch is named only where a launch is possible at all: `ordinary` has
    // no recipe, so it is not-exposed with NO setting, and naming one there
    // would invent a remedy that does not exist (ADR-0045 clause 4). `yad`
    // has a recipe, so its launch is a permission question and says so.
    expect(capabilityOf(ordinary, "launch")?.availability).toBe("not-exposed");
    const yad = applications.find((application) => application.name === "yad") as InstalledApplication;
    expect(capabilityOf(yad, "launch")?.disabledBy).toContain("--permit");
  });

  it("the user's configuration is named where it is the thing withholding the capability", async () => {
    const path = join(dir, "per-application.json");
    writeFileSync(path, JSON.stringify({ applications: { yad: { launch: false } } }));
    const launch = context({
      permits: new Set(["yad"]),
      allows: new Set(["edit", "activate", "submit"]),
      capabilities: loadCapabilitiesFile(path),
      visibility: "all",
    });
    const applications = await listing(launch, inventoryBackend([join(FIXTURE, "system", "applications")]));
    const withEntry = applications.map((application) => application.name);
    expect(withEntry.length).toBeGreaterThan(0);

    // The session HOLDS launch for yad; the user's file is what withholds it,
    // so the file is what gets named - not the flag the session already has.
    const yad = capabilityStateFor(launch, "launch", "yad");
    expect(yad.availability).toBe("disabled-by-configuration");
    expect(yad.disabledBy).toBe('applications["yad"].launch');
  });

  it("an application with no recipe is present and honestly not launchable", async () => {
    const applications = await listing(
      context({ permits: new Set(["ordinary"]), allows: new Set(), visibility: "all" }),
    );
    const ordinary = applications.find((application) => application.name === "ordinary") as InstalledApplication;
    expect(ordinary.launchable).toBe(false);
    // Not launchable is a fact about this daemon's own recipes, and it is a
    // DIFFERENT fact from a permission: no setting would grant it, so it is
    // not-exposed rather than disabled-by-configuration.
    expect(capabilityOf(ordinary, "launch")?.availability).toBe("not-exposed");
    expect(capabilityOf(ordinary, "launch")?.disabledBy).toBeUndefined();
  });

  it("not-launchable is distinguishable from not-installed", async () => {
    const applications = await listing(context());
    const names = applications.map((application) => application.name);
    expect(names).toContain("ordinary");
    expect(names).not.toContain("a-program-nobody-installed");
    // The distinction is the whole point: one is here and cannot be started by
    // us, the other is not here at all.
    expect(applications.find((application) => application.name === "ordinary")?.launchable).toBe(false);
    expect(applications.find((application) => application.name === "yad")?.launchable).toBe(true);
  });

  // AN APPLICATION THIS DAEMON CAN LAUNCH IS NEVER MISSING FROM THE LISTING.
  //
  // Found by the live proof leg, not by this suite: on the machine this was
  // written for, `listApplications` answered 127 entries and `yad` was not one
  // of them - while `openApplication {"name":"yad"}` launched it on request.
  // The listing enumerated the desktop-entry scan alone, and yad ships no
  // .desktop file. So did chrome and gmail, whose recipes exist for exactly
  // the launches this daemon performs most.
  //
  // This suite did not catch it because the fixture had been given a
  // yad.desktop of its own - the offline world was one where every launchable
  // application also had an entry, and the real machine is not that world. A
  // fixture that grants the assumption under test is not a test.
  //
  // The directory used below deliberately EXCLUDES the fixture's yad entry, so
  // the only way `yad` can appear is the way it must: because this daemon has
  // a recipe for it. That is the same false belief ADR-0042 exists to prevent,
  // arriving through the other door - a caller asking what this machine offers
  // must not be told "no" about something the very next call would launch.
  it("an application this daemon can launch is listed even when it ships no desktop entry", async () => {
    const withoutYadEntry = [join(FIXTURE, "home", "applications")];
    // The premise first: the scan alone genuinely does not know this name, so
    // the assertion below cannot pass by the fixture leaking it back in.
    expect(scanInstalledApplications(withoutYadEntry).map((entry) => entry.name)).not.toContain("yad");

    const applications = await listing(context(), inventoryBackend(withoutYadEntry));
    const yad = applications.find((application) => application.name === "yad");
    expect(yad).toBeDefined();
    // Present for the right reason, and honest about it: this daemon can start
    // it, and the setting that withholds the start is named.
    expect((yad as InstalledApplication).launchable).toBe(true);
    expect(capabilityOf(yad as InstalledApplication, "launch")?.availability).toBe("disabled-by-configuration");
    expect(capabilityOf(yad as InstalledApplication, "launch")?.disabledBy).toContain("--permit");
  });

  it("every application this daemon has a recipe for appears in the listing", async () => {
    // Not just the one that was noticed. Any recipe reachable by a caller is a
    // fact about this machine, and a listing that omits any of them is the
    // same defect wearing a different name.
    const applications = await listing(context(), inventoryBackend([join(FIXTURE, "home", "applications")]));
    const listed = new Set(applications.map((application) => application.name));
    for (const recipe of Object.keys(CATALOG)) {
      expect(listed.has(recipe)).toBe(true);
    }
  });

  it("an application that is both installed and launchable is listed exactly once", async () => {
    // The union must not double-count: the fixture's own yad.desktop and the
    // yad recipe describe the same application, and two rows for one
    // application would be a different kind of lie about the machine.
    const applications = await listing(context());
    expect(applications.filter((application) => application.name === "yad")).toHaveLength(1);
    // And the installed entry's own diagnostic survives the merge rather than
    // being replaced by a bare recipe row.
    const yad = applications.find((application) => application.name === "yad") as InstalledApplication;
    expect(yad.diagnostic).toMatchObject({ "mastra-cc/desktop-entry-id": "yad" });
  });

  it("the listing leaks nothing from inside an application", async () => {
    const applications = await listing(context({ visibility: "all", allows: new Set(["edit"]) }));
    const serialised = JSON.stringify(applications);
    for (const forbidden of ["/usr/", "Exec", "window", "element", "text", ".desktop"]) {
      expect(serialised).not.toContain(forbidden);
    }
    // Names, capabilities, launchability and a debug diagnostic. NOTHING
    // ELSE - that is the leak assertion, and it is stated as "no key outside
    // this set" rather than "exactly this set" because the diagnostic is
    // genuinely optional: an application known only from a launch recipe has
    // no desktop entry to have said anything about it (schema:
    // InstalledApplication.diagnostic). Demanding the key be present would
    // force this daemon to invent a diagnostic for those rows, which is the
    // opposite of the rule the assertion is protecting.
    const allowed = ["capabilities", "diagnostic", "launchable", "name"];
    for (const application of applications) {
      for (const key of Object.keys(application)) expect(allowed).toContain(key);
      // The load-bearing three are never optional.
      expect(Object.keys(application)).toEqual(expect.arrayContaining(["capabilities", "launchable", "name"]));
    }
  });

  it("a backend that cannot enumerate refuses by name rather than answering an empty list", async () => {
    const backend = {
      ...inventoryBackend(),
      installedApplications: async () => {
        throw new InventoryUnsupportedError("this route cannot look");
      },
    } as unknown as Backend;
    const answer = await handleRequest(
      { type: "request", id: 1, method: "listApplications", params: {} },
      backend,
      context(),
    );
    const result = answer.result as { applications?: InstalledApplication[]; refusal?: string };
    expect(result.applications).toBeUndefined();
    expect(result.refusal).toBe(LIST_APPLICATIONS_REFUSAL);
    // An empty list would say the machine has nothing installed, which is a
    // false belief about the machine rather than a true one about the route.
    expect(LIST_APPLICATIONS_REFUSAL).toContain("cannot enumerate");
  });
});

describe("the listing and the enforcement do not disagree", () => {
  // THE AGREEMENT TEST. Listing and gate are driven from one function
  // (capabilityStateFor), and this proves the wire answer and the gate's
  // behaviour match for every capability, on a session that holds a mixed set.
  // A daemon that maintained two lists could pass every other test in this
  // file on the day the lists happened to match.
  const path = join(dir, "agreement.json");
  writeFileSync(path, JSON.stringify({ defaults: { activate: false } }));

  const launch = context({
    permits: new Set(["yad"]),
    allows: new Set(["edit", "activate"]),
    capabilities: loadCapabilitiesFile(path),
    visibility: "all",
  });

  it("a capability the listing reports available is one the gate does not refuse, and the reverse", async () => {
    const applications = await listing(launch);
    expect(applications.length).toBeGreaterThan(0);

    for (const application of applications) {
      for (const capability of application.capabilities) {
        const enforced = capabilityStateFor(launch, capability.capability, application.name);
        // The wire answer IS the gate's answer - same state, same setting.
        expect(capability.availability).toBe(enforced.availability);
        expect(capability.disabledBy).toBe(enforced.disabledBy);
      }
    }
  });

  it("what the listing says about an effect capability is what the wire method actually does", async () => {
    // The assertion above compares capabilityStateFor with itself: the listing
    // is BUILT from that function, so it proves the two are one table but
    // proves nothing about the dispatch that callers actually reach. This one
    // drives the real wire methods and compares their behaviour against the
    // row the listing published, which is the claim ADR-0042 makes to a
    // caller - "available" means the call proceeds, and every other state
    // means it is refused before the backend is touched (pin B11).
    const element: SemanticElement = {
      id: "el-000000000000",
      role: "text",
      name: "message",
      states: ["enabled", "visible"],
      content: { kind: "unavailable", reason: "not-exposed" },
      actions: [{ name: "click", availability: "available" }],
      operations: [],
    };
    // Reached only when the gate lets the call through, and its arrival is
    // therefore the evidence that the listing's "available" was true. Every
    // refusal below must happen without this being called at all.
    let reached: string | undefined;
    const backend = {
      ...inventoryBackend(),
      queryElements: async () => ({ elements: [element] }),
      attestElement: async () => ({ element }),
      applicationOfElement: () => "yad",
      editElement: async () => {
        reached = "edit";
        return { element };
      },
      activateElement: async () => {
        reached = "activate";
        return { element };
      },
      submitElement: async () => {
        reached = "submit";
        return { element };
      },
    } as unknown as Backend;

    const call = {
      edit: { method: "editElement", params: { id: element.id, value: "typed" } },
      activate: { method: "activateElement", params: { id: element.id, action: "click" } },
      submit: { method: "submitElement", params: { id: element.id, attestation: "commit" } },
    } as const;

    const [listed] = (await listing(launch, backend)).filter((application) => application.name === "yad");
    expect(listed).toBeDefined();

    for (const [capability, request] of Object.entries(call)) {
      const row = capabilityOf(listed, capability);
      expect(row).toBeDefined();
      reached = undefined;
      const answer = await handleRequest({ type: "request", id: 3, ...request }, backend, launch);
      const result = (answer.result ?? {}) as { element?: SemanticElement; refusal?: string };
      const refusal = answer.refusal ?? result.refusal;
      if (row?.availability === "available") {
        // The listing promised it; the method must have proceeded.
        expect(refusal).toBeUndefined();
        expect(reached).toBe(capability);
      } else {
        // The listing withheld it; the method must refuse, and the backend
        // must never have been asked (before-call, not at-result).
        expect(refusal).toBeDefined();
        expect(reached).toBeUndefined();
        // And the refusal is actionable. The two surfaces name the same
        // remedy in two vocabularies, and this asserts what is actually true
        // of each rather than a byte match they do not share: a capability the
        // CONFIGURATION withheld is refused with that file setting named, and
        // a capability the SESSION never held is refused by a sentence that
        // names the class - the flag spelling lives in the listing's
        // disabledBy, because the session refusals predate the listing and are
        // pinned byte-identical elsewhere. A caller has the setting either
        // way; only one of them has it inside the refusal string.
        if (row?.disabledBy?.startsWith("the session flag") === false) {
          expect(refusal).toContain(row.disabledBy);
        } else {
          expect(refusal).toContain(capability);
        }
      }
    }
  });

  it("every capability the listing advertises is one a wire method actually enforces", async () => {
    // A listing that advertises what nothing enforces teaches a caller a
    // capability that does not exist. `close` is the live example: the seam
    // has it, no wire method does, and it is therefore not a capability.
    expect([...CAPABILITY_NAMES]).not.toContain("close");
    const applications = await listing(launch);
    for (const application of applications) {
      for (const capability of application.capabilities) {
        expect([...CAPABILITY_NAMES]).toContain(capability.capability);
      }
    }
  });

  it("the launch refusal and the launch capability agree about the same application", async () => {
    // The listing says yad's launch is available on this session; the gate
    // must then not refuse it with the unavailable constant. `sleep` is in no
    // recipe and no permit, and both halves must say so together.
    expect(capabilityStateFor(launch, "launch", "yad").availability).toBe("available");

    const refused = await handleRequest(
      { type: "request", id: 2, method: "openApplication", params: { name: "sleep" } },
      inventoryBackend(),
      launch,
    );
    expect((refused.result as { refusal?: string }).refusal).toBe(UNAVAILABLE_REFUSAL);
    expect(capabilityStateFor(launch, "launch", "sleep").availability).not.toBe("available");
  });

  it("the rewritten refusal names where the answer lives, and still nothing about this machine", () => {
    // ADR-0042 moves existence into the LISTING, not into the refusal: the
    // unknown name and the unpermitted name still answer byte-identically, so
    // a caller guessing names at openApplication learns nothing from a guess.
    expect(UNAVAILABLE_REFUSAL).toContain("listApplications");
    const lowered = UNAVAILABLE_REFUSAL.toLowerCase();
    expect(lowered).not.toContain("/");
    expect(lowered).not.toContain("install");
    expect(lowered).not.toContain("sleep");
    expect(lowered).not.toContain("yad");
  });
});

describe("configuration composed at boot reaches the listing", () => {
  it("a session with no configuration file lists exactly what the session gates hold", async () => {
    const launch = context({
      permits: new Set(),
      allows: new Set(["submit"]),
      capabilities: WITHHOLDS_NOTHING,
      visibility: "all",
    });
    const applications = await listing(launch);
    const ordinary = applications.find((application) => application.name === "ordinary") as InstalledApplication;
    expect(capabilityOf(ordinary, "submit")?.availability).toBe("available");
    expect(capabilityOf(ordinary, "edit")?.availability).toBe("disabled-by-configuration");
    expect(capabilityOf(ordinary, "observe")?.availability).toBe("available");
  });
});

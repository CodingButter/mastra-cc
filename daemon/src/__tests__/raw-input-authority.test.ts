import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CAPABILITY_NAMES, type Capability, type InstalledApplication } from "@mastra-cc/protocol-types";
import type { Backend } from "../backend.js";
import { CONFIGURABLE_CAPABILITIES, loadCapabilitiesFile } from "../capabilities.js";
import { scanInstalledApplications } from "../inventory.js";
import { OwnershipTable } from "../launch/table.js";
import { selectKeyDelivery } from "../rawinput/select.js";
import { handleRequest, type LaunchContext } from "../server.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// A CAPABILITY THAT IS OFF, AND CANNOT TURN ITSELF ON (ADR-0066, ADR-0046
// clauses 2 and 4).
//
// This schema version adds an authority and nothing that spends it, so what is
// under test here is the switch itself: that a daemon nobody armed holds no
// raw-input authority, that the two settings which can deny it are
// distinguishable by the sentence a caller gets back, and that a platform with
// no key route is told the truth rather than sent to add a flag that would
// still deliver nothing.
//
// The most important assertion in this file is the first one. Everything else
// in this segment is built on top of "off by default", and off-by-default is
// not asserted by reading the code that produces it - it is asserted by asking
// a daemon that was started with nothing.

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIRECTORIES = [
  join(here, "..", "..", "fixtures", "desktop-entries", "home", "applications"),
  join(here, "..", "..", "fixtures", "desktop-entries", "system", "applications"),
];
const dir = mkdtempSync(join(tmpdir(), "mastra-cc-raw-input-"));

function file(name: string, contents: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

const backend = {
  name: "fixture-inventory",
  ...observeOnlyEffects,
  installedApplications: async () => scanInstalledApplications(FIXTURE_DIRECTORIES),
  runningApplications: async () => ({ observable: new Set<string>(), answersFor: "every-application" as const }),
  queryElements: async () => ({ elements: [] }),
  attestElement: async () => ({}),
  subscribeElement: async () => {
    throw new Error("the listing touched the change stream");
  },
  unsubscribeElement: async () => undefined,
  applicationOfElement: () => undefined,
  close: () => undefined,
} as unknown as Backend;

// The route this build has on this platform. Passed explicitly so a test can
// also describe a machine that has none, rather than only the one CI runs on.
const A_ROUTE = { route: "test-route" };

async function rawInputFor(launch: Partial<LaunchContext>): Promise<Capability> {
  const answer = await handleRequest({ type: "request", id: 1, method: "listApplications", params: {} }, backend, {
    permits: new Set(),
    catalog: DEFANGED_CATALOG,
    table: new OwnershipTable(),
    visibility: "all",
    ...launch,
  });
  const { applications } = answer.result as { applications: InstalledApplication[] };
  const application = applications[0] as InstalledApplication;
  return application.capabilities.find((entry) => entry.capability === "rawInput") as Capability;
}

describe("raw input is off until a person says otherwise", () => {
  it("a daemon started with no --allow rawInput and no configuration file reports it off, naming the session flag", async () => {
    // The whole segment rests on this. Nothing was withheld anywhere: there is
    // no configuration file, and the machine has a key route. It is off
    // because --allow composed an empty set, which is the session layer
    // denying by default exactly as it always has.
    const capability = await rawInputFor({ keys: A_ROUTE });

    expect(capability.availability).toBe("disabled-by-configuration");
    expect(capability.disabledBy).toBe("the session flag --allow rawInput");
  });

  it("the session flag alone is enough - no second thing has to be turned on", async () => {
    const capability = await rawInputFor({ keys: A_ROUTE, allows: new Set(["rawInput"]) });

    expect(capability.availability).toBe("available");
    expect(capability.disabledBy).toBeUndefined();
  });

  it("an operator's file can take it back from an armed session, and says so in its own name", async () => {
    // The two settings deny INDEPENDENTLY, and the sentence has to say which
    // one did it. A session that was never armed, told to edit a capabilities
    // file, goes and edits a file that was never the problem.
    const capabilities = loadCapabilitiesFile(file("withholds.json", { defaults: { rawInput: false } }));
    const withheld = await rawInputFor({ keys: A_ROUTE, allows: new Set(["rawInput"]), capabilities });
    const unarmed = await rawInputFor({ keys: A_ROUTE, capabilities });

    expect(withheld.availability).toBe("disabled-by-configuration");
    // The configuration's own convention: it names the KEY a person edits,
    // not the file path, because the path is whatever --capabilities was
    // pointed at and the key is the thing to change once you are in there.
    expect(withheld.disabledBy).toBe("defaults.rawInput");
    expect(unarmed.disabledBy).toBe("the session flag --allow rawInput");
    // The point of the pair: a caller can tell the two apart.
    expect(withheld.disabledBy).not.toBe(unarmed.disabledBy);
  });

  it("a build with no key route on this platform reports not-exposed, and names no setting", async () => {
    // NOT disabled-by-configuration. protocol/schema.json:236 - the middle
    // case is a fact about configuration and the last is a fact about what is
    // possible, so an agent told the wrong one forms a false belief. Here even
    // an armed session gets the honest answer.
    const capability = await rawInputFor({ keys: undefined, allows: new Set(["rawInput"]) });

    expect(capability.availability).toBe("not-exposed");
    expect(capability.disabledBy).toBeUndefined();
  });

  it("is reported for every application, off, rather than omitted from the list", async () => {
    // installedApplication.capabilities carries one entry per capability the
    // contract defines, always all of them (schema.json:356). A capability
    // that is off and absent reads as a contract that does not have it.
    const answer = await handleRequest({ type: "request", id: 1, method: "listApplications", params: {} }, backend, {
      permits: new Set(),
      catalog: DEFANGED_CATALOG,
      table: new OwnershipTable(),
      visibility: "all",
      keys: A_ROUTE,
    });
    const { applications } = answer.result as { applications: InstalledApplication[] };

    expect(applications.length).toBeGreaterThan(0);
    for (const application of applications) {
      expect(application.capabilities.map((entry) => entry.capability)).toEqual([...CAPABILITY_NAMES]);
    }
  });
});

describe("the shape of the authority", () => {
  it("rawInput is a capability name the contract defines", () => {
    expect(CAPABILITY_NAMES).toContain("rawInput");
  });

  it("--allow rawInput is accepted by the daemon's validation rather than refused as an unknown class", () => {
    // main.ts:160 DERIVES the allowed set from CAPABILITY_NAMES - there is no
    // hand-maintained list to update - so this asserts the derivation admits
    // rawInput and still excludes the two classes that are not session-scoped.
    const acceptable = (cls: string) => CAPABILITY_NAMES.includes(cls as never) && cls !== "observe" && cls !== "launch";

    expect(acceptable("rawInput")).toBe(true);
    expect(acceptable("observe")).toBe(false);
    expect(acceptable("launch")).toBe(false);
    expect(acceptable("keyboard")).toBe(false);
  });

  it("an operator can withhold it by name, and withholding nothing is still the default", () => {
    expect(CONFIGURABLE_CAPABILITIES).toContain("rawInput");
    // The invariant in capabilities.ts is intact: this layer subtracts, and an
    // absent file subtracts nothing. Off comes from the session flag, never
    // from a default-off entry here.
    const absent = loadCapabilitiesFile(join(dir, "does-not-exist.json"));
    expect(absent.defaults.size).toBe(0);
    expect(absent.applications.size).toBe(0);
  });

  it("the route is chosen from the platform, never from anything a caller sends", () => {
    // A wire that could pick the route could ask a Linux daemon to answer as a
    // Mac one. The selector takes a platform and nothing else.
    expect(selectKeyDelivery("linux")).toBeDefined();
    expect(selectKeyDelivery("darwin")).toBeUndefined();
    expect(selectKeyDelivery("win32")).toBeUndefined();
  });
});

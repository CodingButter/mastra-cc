import { describe, expect, it } from "vitest";
import type { InstalledApplication } from "@mastra-cc/protocol-types";
import { InventoryUnsupportedError, type Backend } from "../backend.js";
import type { InventoryEntry } from "../inventory.js";
import type { LaunchCatalog } from "../launch/recipes.js";
import { OwnershipTable } from "../launch/table.js";
import {
  AMBIGUOUS_NAME_REFUSAL,
  UNAVAILABLE_REFUSAL,
  capabilityStateFor,
  handleRequest,
  indexInventory,
  resolvePermitted,
  type LaunchContext,
} from "../server.js";

// ONE ENTRY, SEVERAL NAMES, ONE PERMISSION.
//
// The census has always known that org.kde.kate answers to `kate`; the permit
// gate did not, so bring-up scripts permitted every application twice. These
// tests pin the repaired shape: permits and grants resolve through the same
// entry-derived candidates the census reads - id, appears-as translation,
// final dot-segment - with the display label (Name=) census-only, because on a
// real desk human labels are exactly where names collide. An ambiguous name
// authorises NOTHING: the gate refuses rather than picks, the same
// degradation the census applies to a contested runtime match.

const KATE: InventoryEntry = { name: "org.kde.kate", diagnostic: { "mastra-cc/display-name": "Kate" } };
const DOLPHIN: InventoryEntry = { name: "org.kde.dolphin", diagnostic: { "mastra-cc/display-name": "Dolphin" } };
// A second entry whose final dot-segment collides with kate's - the shape a
// stray vendor entry takes on a real desk.
const DECOY: InventoryEntry = { name: "vendor.fork.kate", diagnostic: { "mastra-cc/display-name": "Kate Fork" } };

const EMPTY_CATALOG: LaunchCatalog = {};

function context(overrides: Partial<LaunchContext>): LaunchContext {
  return { permits: new Set(), catalog: EMPTY_CATALOG, table: new OwnershipTable(), ...overrides };
}

function backendWith(installed: InventoryEntry[] | "unsupported"): Backend {
  return {
    installedApplications: async () => {
      if (installed === "unsupported") throw new InventoryUnsupportedError("this route cannot look");
      return installed;
    },
    listApplications: async () => [],
    runningApplications: async () => ({ observable: new Set<string>(), answersFor: new Set<string>() }),
  } as unknown as Backend;
}

async function open(name: string, launch: LaunchContext, backend: Backend): Promise<{ refusal?: string }> {
  const answer = await handleRequest({ type: "request", id: 1, method: "openApplication", params: { name } }, backend, launch);
  return answer.result as { refusal?: string };
}

describe("permits resolve through the entry's own candidate names", () => {
  const index = indexInventory([KATE, DOLPHIN], EMPTY_CATALOG);

  it("a permit for the full id authorises a request by the short name", () => {
    const permits = new Set(["org.kde.kate"]);
    const resolved = resolvePermitted("kate", index, EMPTY_CATALOG, permits);
    expect(resolved.kind).toBe("permitted");
    expect(resolved.kind === "permitted" && resolved.entry?.name).toBe("org.kde.kate");
  });

  it("a permit for the short name authorises a request by the full id", () => {
    const permits = new Set(["kate"]);
    expect(resolvePermitted("org.kde.kate", index, EMPTY_CATALOG, permits).kind).toBe("permitted");
  });

  it("the Name= display label is census-only and carries no permission", () => {
    // Permitting the human label authorises nothing: labels are where real
    // desks collide (13 of 16 measured collisions were Name= labels), and a
    // wrong permission match exposes the wrong application.
    const permits = new Set(["Kate"]);
    expect(resolvePermitted("org.kde.kate", index, EMPTY_CATALOG, permits).kind).toBe("unpermitted");
    expect(resolvePermitted("Kate", index, EMPTY_CATALOG, permits).kind).toBe("unpermitted");
  });

  it("one entry's permit does not leak to another entry", () => {
    const permits = new Set(["org.kde.kate"]);
    expect(resolvePermitted("org.kde.dolphin", index, EMPTY_CATALOG, permits).kind).toBe("unpermitted");
    expect(resolvePermitted("dolphin", index, EMPTY_CATALOG, permits).kind).toBe("unpermitted");
  });

  it("a name nothing on a READ inventory claims is unpermitted without consulting the permit set", () => {
    // Known-empty is not unavailable: the desk was enumerated and does not
    // publish this name, so even a permit naming it exactly authorises nothing.
    const permits = new Set(["ghost"]);
    expect(resolvePermitted("ghost", indexInventory([], EMPTY_CATALOG), EMPTY_CATALOG, permits).kind).toBe("unpermitted");
    expect(resolvePermitted("ghost", index, EMPTY_CATALOG, permits).kind).toBe("unpermitted");
  });

  it("an UNREAD inventory degrades to the exact check, losing nothing the gate could ever do", () => {
    const permits = new Set(["ghost"]);
    expect(resolvePermitted("ghost", undefined, EMPTY_CATALOG, permits).kind).toBe("permitted");
    expect(resolvePermitted("kate", undefined, EMPTY_CATALOG, permits).kind).toBe("unpermitted");
  });
});

describe("an ambiguous name authorises nothing", () => {
  const index = indexInventory([KATE, DECOY], EMPTY_CATALOG);

  it("a short name two entries claim refuses, whatever the permits say", () => {
    const permits = new Set(["kate", "org.kde.kate", "vendor.fork.kate"]);
    expect(resolvePermitted("kate", index, EMPTY_CATALOG, permits).kind).toBe("ambiguous");
  });

  it("each entry's exact full id still resolves - ambiguity poisons the shared name, not the entries", () => {
    const permits = new Set(["org.kde.kate", "vendor.fork.kate"]);
    expect(resolvePermitted("org.kde.kate", index, EMPTY_CATALOG, permits).kind).toBe("permitted");
    expect(resolvePermitted("vendor.fork.kate", index, EMPTY_CATALOG, permits).kind).toBe("permitted");
  });

  it("a contested candidate cannot CARRY permission - permitting `kate` authorises neither entry", () => {
    const permits = new Set(["kate"]);
    expect(resolvePermitted("org.kde.kate", index, EMPTY_CATALOG, permits).kind).toBe("unpermitted");
    expect(resolvePermitted("vendor.fork.kate", index, EMPTY_CATALOG, permits).kind).toBe("unpermitted");
  });

  it("a shared appears-as does not make the sibling's exact id ambiguous, and one permit covers one entry", () => {
    // chrome and gmail both appear as `chrome` in the real catalog: the exact
    // id must keep resolving, and `--permit chrome` must not authorise gmail.
    const catalog: LaunchCatalog = {
      chrome: { argv: ["sleep", "30"], env: {}, appearsAs: "chrome" },
      gmail: { argv: ["sleep", "30"], env: {}, appearsAs: "chrome" },
    };
    const shared = indexInventory([], catalog);
    expect(resolvePermitted("chrome", shared, catalog, new Set(["chrome"])).kind).toBe("permitted");
    const gmail = resolvePermitted("gmail", shared, catalog, new Set(["chrome"]));
    expect(gmail.kind).toBe("unpermitted");
  });
});

describe("the launch gate on the wire", () => {
  it("an ambiguous request refuses with its own words, distinct from unpermitted", async () => {
    const launch = context({ permits: new Set(["org.kde.kate"]) });
    const answer = await open("kate", launch, backendWith([KATE, DECOY]));
    expect(answer.refusal).toBe(AMBIGUOUS_NAME_REFUSAL);
    expect(AMBIGUOUS_NAME_REFUSAL).not.toBe(UNAVAILABLE_REFUSAL);
    expect(AMBIGUOUS_NAME_REFUSAL).toContain("full id");
  });

  it("a short-name request for a permitted full id passes the gate and acts on the entry's id", async () => {
    const catalog: LaunchCatalog = { "org.kde.kate": { argv: ["sleep", "30"], env: {} } };
    const launch = context({ permits: new Set(["org.kde.kate"]), catalog, pollBudgetMs: 30, pollIntervalMs: 10 });
    const answer = await open("kate", launch, backendWith([KATE]));
    // Defanged argv never becomes readable; what matters is the gate did NOT
    // turn the short name away, and the launch was owned under the full id.
    expect(answer.refusal).not.toBe(UNAVAILABLE_REFUSAL);
    expect(answer.refusal).not.toBe(AMBIGUOUS_NAME_REFUSAL);
    expect(launch.table.ownsName("org.kde.kate")).toBeDefined();
  });

  it("a catalog-recipe-only name launches through the ordinary one-entry rule", async () => {
    const catalog: LaunchCatalog = { yad: { argv: ["sleep", "30"], env: {} } };
    const launch = context({ permits: new Set(["yad"]), catalog, pollBudgetMs: 30, pollIntervalMs: 10 });
    // The scan sees nothing; the catalog key becomes the synthetic entry.
    const answer = await open("yad", launch, backendWith([]));
    expect(answer.refusal).not.toBe(UNAVAILABLE_REFUSAL);
    expect(launch.table.ownsName("yad")).toBeDefined();
  });
});

describe("grants resolve through the same candidates", () => {
  it("a grant for the full id makes the short-name entry observable, and the wire listing agrees", async () => {
    const launch = context({
      permits: new Set(["org.kde.kate"]),
      visibility: new Set(["org.kde.kate"]),
      catalog: { "org.kde.kate": { argv: ["sleep", "30"], env: {} } },
    });
    const answer = await handleRequest(
      { type: "request", id: 1, method: "listApplications", params: {} },
      backendWith([KATE, DOLPHIN]),
      launch,
    );
    const applications = (answer.result as { applications: InstalledApplication[] }).applications;
    const kate = applications.find((application) => application.name === "org.kde.kate");
    const dolphin = applications.find((application) => application.name === "org.kde.dolphin");
    expect(kate?.capabilities.find((capability) => capability.capability === "observe")?.availability).toBe("available");
    expect(kate?.capabilities.find((capability) => capability.capability === "launch")?.availability).toBe("available");
    // The ungranted neighbour stays dark - candidate matching widens which
    // NAMES reach an entry, never which entries a grant covers.
    expect(dolphin?.capabilities.find((capability) => capability.capability === "observe")?.availability).toBe("disabled-by-configuration");
  });

  it("a grant for a contested short name authorises neither claimant", () => {
    const index = indexInventory([KATE, DECOY], EMPTY_CATALOG);
    const launch = context({ visibility: new Set(["kate"]) });
    const observe = capabilityStateFor(launch, "observe", "org.kde.kate", index);
    expect(observe.availability).toBe("disabled-by-configuration");
  });

  it("without an index, capabilityStateFor keeps its exact-name behaviour", () => {
    const launch = context({
      permits: new Set(["org.kde.kate"]),
      visibility: new Set(["org.kde.kate"]),
      catalog: { "org.kde.kate": { argv: ["sleep", "30"], env: {} } },
    });
    expect(capabilityStateFor(launch, "launch", "org.kde.kate").availability).toBe("available");
    // Short name, no index: no recipe by that exact name, so daemon reach
    // reports not-exposed - exactly what a bare caller has always been told.
    expect(capabilityStateFor(launch, "launch", "kate").availability).toBe("not-exposed");
    expect(capabilityStateFor(launch, "observe", "org.kde.kate").availability).toBe("available");
    expect(capabilityStateFor(launch, "observe", "kate").availability).toBe("disabled-by-configuration");
  });
});

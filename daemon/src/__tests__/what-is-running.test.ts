import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { InstalledApplication } from "@mastra-cc/protocol-types";
import type { Backend, RunningCensus } from "../backend.js";
import { scanInstalledApplications } from "../inventory.js";
import { OBSERVE_SETTING } from "../capabilities.js";
import { OwnershipTable } from "../launch/table.js";
import { handleRequest, type LaunchContext } from "../server.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// WHAT IS RUNNING, ON THE WIRE (issue #53, ADR-0063).
//
// The listing could say a machine has an editor and never whether the editor
// was already open, so an agent's only move was to launch a second copy or to
// read an empty query as an absent application. These tests pin the three
// answers and, more importantly, pin which of them an ungranted session gets:
// not "false", which would be a claim about the desk manufactured out of a
// fact about permission.

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIRECTORIES = [
  join(here, "..", "..", "fixtures", "desktop-entries", "home", "applications"),
  join(here, "..", "..", "fixtures", "desktop-entries", "system", "applications"),
  join(here, "..", "..", "fixtures", "desktop-entries", "second", "applications"),
];

// A backend that enumerates the fixture and answers a census we hand it. The
// census is the ONLY thing that varies between these tests, so a difference in
// the reply is a difference in how the server read it.
function backendSeeing(census: RunningCensus): Backend {
  return {
    name: "fixture-inventory",
    ...observeOnlyEffects,
    installedApplications: async () => scanInstalledApplications(FIXTURE_DIRECTORIES),
    runningApplications: async () => census,
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

const wholeDesk = (...names: string[]): RunningCensus => ({
  observable: new Set(names),
  answersFor: "every-application",
});

async function listing(launch: Partial<LaunchContext>, census: RunningCensus): Promise<InstalledApplication[]> {
  const answer = await handleRequest(
    { type: "request", id: 1, method: "listApplications", params: {} },
    backendSeeing(census),
    { permits: new Set(), catalog: DEFANGED_CATALOG, table: new OwnershipTable(), ...launch },
  );
  const result = answer.result as { applications?: InstalledApplication[]; refusal?: string };
  expect(result.refusal).toBeUndefined();
  return result.applications as InstalledApplication[];
}

const entry = (applications: InstalledApplication[], name: string) =>
  applications.find((application) => application.name === name) as InstalledApplication;

describe("the listing says what is answering, not just what is installed", () => {
  it("a granted application that is on the bus reports observable", async () => {
    const applications = await listing({ visibility: "all" }, wholeDesk("ordinary"));

    expect(entry(applications, "ordinary").running).toBe("answering");
    // Nothing to act on: the state stands alone, because a setting is only
    // named where changing it would change the answer.
    expect(entry(applications, "ordinary").runningUnknownBy).toBeUndefined();
  });

  it("a granted application absent from a fully enumerated desk reports not-answering", async () => {
    const applications = await listing({ visibility: "all" }, wholeDesk("ordinary"));

    // The horizon is what makes this a measurement rather than a shrug: this
    // route enumerated everything, so absence means absent.
    expect(entry(applications, "hidden-from-menus").running).toBe("not-answering");
    expect(entry(applications, "hidden-from-menus").runningUnknownBy).toBeUndefined();
  });

  it("an application this session may not observe reports cannot-tell and NAMES the grants file", async () => {
    // The desk is the same desk - the census can see it running. What differs
    // is permission, and permission may not produce a statement about the
    // desk. This is the assertion the whole three-state design exists for.
    const applications = await listing({ visibility: new Set(["something-else"]) }, wholeDesk("ordinary"));

    expect(entry(applications, "ordinary").running).toBe("cannot-tell");
    expect(entry(applications, "ordinary").runningUnknownBy).toBe(OBSERVE_SETTING);
  });

  it("and never reports it as not running, however the census answers", async () => {
    // Both directions of the census, one ungranted session: neither a running
    // application nor an absent one may reach an ungranted caller as a fact.
    const running = await listing({ visibility: new Set() }, wholeDesk("ordinary"));
    const notRunning = await listing({ visibility: new Set() }, wholeDesk());

    for (const applications of [running, notRunning]) {
      expect(entry(applications, "ordinary").running).toBe("cannot-tell");
    }
  });

  it("a session with no grants composed at all is denied by default, not told everything", async () => {
    // ADR-0036's posture, asserted on the new field: an absent visibility set
    // is nothing granted, not everything.
    const applications = await listing({}, wholeDesk("ordinary"));

    expect(entry(applications, "ordinary").running).toBe("cannot-tell");
    expect(entry(applications, "ordinary").runningUnknownBy).toBe(OBSERVE_SETTING);
  });

  it("a granted name the answering route has no view of reports a bare cannot-tell", async () => {
    // The browser route's shape: it speaks for one endpoint. The session may
    // look, so the grants file is NOT named - no setting would help, and
    // sending a person to edit one would be a false remedy.
    const applications = await listing(
      { visibility: "all" },
      { observable: new Set(["chromium"]), answersFor: new Set(["chromium"]) },
    );

    expect(entry(applications, "ordinary").running).toBe("cannot-tell");
    expect(entry(applications, "ordinary").runningUnknownBy).toBeUndefined();
  });

  it("asks the census under the name the desk actually uses, not the desktop-entry id", async () => {
    // The live proof caught this one: Kate was open on screen and the listing
    // said not-answering, because the census keys on `kate` and the entry is
    // named `org.kde.kate`. The launch layer already owns that translation
    // through appearsAs, and running-state borrows it instead of inventing a
    // second answer to the same question.
    const applications = await handleRequest(
      { type: "request", id: 1, method: "listApplications", params: {} },
      backendSeeing(wholeDesk("editor-binary")),
      {
        permits: new Set(),
        catalog: { ordinary: { argv: ["sleep", "30"], env: {}, appearsAs: "editor-binary" } },
        table: new OwnershipTable(),
        visibility: "all",
      },
    ).then((answer) => (answer.result as { applications: InstalledApplication[] }).applications);

    expect(entry(applications, "ordinary").running).toBe("answering");
    // And a name with no recipe still asks under itself.
    expect(entry(applications, "hidden-from-menus").running).toBe("not-answering");
  });

  it("answers under the runtime name an entry id implies, not only under ids the catalog has a recipe for", async () => {
    // The appears-as join covers applications this daemon knows how to start,
    // which is the minority. `org.kde.dolphin` has no recipe and runs as
    // `dolphin` all the same, and asking under the id alone reported a file
    // manager sitting open on screen as closed - the same bug the live proof
    // caught for Kate, surviving everywhere the catalog does not reach.
    const applications = await handleRequest(
      { type: "request", id: 1, method: "listApplications", params: {} },
      backendSeeing(wholeDesk("dolphin")),
      {
        permits: new Set(),
        catalog: { "org.kde.dolphin": { argv: ["sleep", "30"], env: {} } },
        table: new OwnershipTable(),
        visibility: "all",
      },
    ).then((answer) => (answer.result as { applications: InstalledApplication[] }).applications);

    expect(entry(applications, "org.kde.dolphin").running).toBe("answering");
  });

  it("refuses to pick when two entries could both be the name that is answering", async () => {
    // Two fixture entries publish the same display name. The bus publishes a
    // name, not which entry started it, so naming one of them the running one
    // would be a coin flip reported as a reading.
    const applications = await listing({ visibility: "all" }, wholeDesk("Same Display Name"));

    expect(entry(applications, "collide-one").running).toBe("cannot-tell");
    expect(entry(applications, "collide-two").running).toBe("cannot-tell");
    // Ignorance about the desk, not about permission: no setting would help.
    expect(entry(applications, "collide-one").runningUnknownBy).toBeUndefined();
  });

  it("still lists what is installed when the census instrument fails outright", async () => {
    // Before this field existed the listing was a filesystem scan and answered
    // on a machine with no accessibility bus at all. A census that throws must
    // not take the installed set down with it - and must not be flattened into
    // "nothing is running" either.
    const backend = {
      ...backendSeeing(wholeDesk()),
      runningApplications: async () => {
        throw new Error("the accessibility registry did not answer");
      },
    } as unknown as Backend;
    const applications = await handleRequest(
      { type: "request", id: 1, method: "listApplications", params: {} },
      backend,
      { permits: new Set(), catalog: DEFANGED_CATALOG, table: new OwnershipTable(), visibility: "all" },
    ).then((answer) => (answer.result as { applications: InstalledApplication[] }).applications);

    expect(applications.length).toBeGreaterThan(1);
    for (const application of applications) {
      expect(application.running).toBe("cannot-tell");
      expect(application.runningUnknownBy).toBeUndefined();
    }
  });

  it("every entry carries the field, and the listing is not vacuous", async () => {
    const applications = await listing({ visibility: "all" }, wholeDesk("ordinary"));

    expect(applications.length).toBeGreaterThan(1);
    // Never silently absent: a missing field reads as a no (schema 1.7.0).
    for (const application of applications) {
      expect(["answering", "not-answering", "cannot-tell"]).toContain(application.running);
    }
    // And the answers are not all the same one, which is what would make every
    // assertion above pass against a server that ignored the census entirely.
    expect(new Set(applications.map((application) => application.running)).size).toBeGreaterThan(1);
  });

  it("looks the name up normalised, the way every other layer matches them", async () => {
    // The census speaks NFKC (its own contract, pinned in the backend suite),
    // and so must the lookup. A fixture entry whose id differs from its
    // display name is the honest case here: the id is what the census keys on
    // and what a caller names, and both go through normalise() before meeting.
    const applications = await listing({ visibility: "all" }, wholeDesk("collide-one"));

    expect(entry(applications, "collide-one").running).toBe("answering");
    expect(entry(applications, "collide-two").running).toBe("not-answering");
  });
});

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { InstalledApplication } from "@mastra-cc/protocol-types";
import type { Backend, RunningCensus } from "../backend.js";
import { scanInstalledApplications } from "../inventory.js";
import { OBSERVE_SETTING } from "../capabilities.js";
import {
  ACQUIRE_SETTING,
  type AccessibilityLayer,
  type AccessibilityLayerState,
  type AccessibilityReport,
} from "../accessibility/index.js";
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

// A LAYER THAT REPORTS WHAT IT IS TOLD TO, and counts how often it was asked.
// The count is load-bearing: this reading is a D-Bus round trip and the listing
// answers for every installed application, so once-per-request is a
// correctness property of the listing, not a preference.
function layerReporting(state: AccessibilityLayerState): AccessibilityLayer & { reads: number } {
  const layer = {
    reads: 0,
    acquirable: true,
    async report(): Promise<AccessibilityReport> {
      layer.reads += 1;
      return state === "cannot-tell" ? { state, reason: "the test said so" } : { state };
    },
    async acquire() {
      throw new Error("the listing tried to switch the machine's accessibility layer on");
    },
  };
  return layer;
}

// Every test below that is NOT about the accessibility layer composes a desk
// that can be heard, so its subject stays the census. Before this reading
// existed the layer was simply absent, and an absent layer is now (correctly)
// an ignorance of its own - see the no-adapter test.
async function listing(launch: Partial<LaunchContext>, census: RunningCensus): Promise<InstalledApplication[]> {
  const answer = await handleRequest(
    { type: "request", id: 1, method: "listApplications", params: {} },
    backendSeeing(census),
    {
      permits: new Set(),
      catalog: DEFANGED_CATALOG,
      table: new OwnershipTable(),
      accessibility: layerReporting("enabled"),
      ...launch,
    },
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
        accessibility: layerReporting("enabled"),
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

// A DESK THAT CANNOT HEAR HAS NOT SAID THE APPLICATION IS GONE (ADR-0063,
// amended). Found by dogfooding: a fresh demo container reports
// org.a11y.Status/IsEnabled as false, and the daemon reported all hundred-odd
// installed applications absent while several sat open on screen. The silence
// was the machine's ears, and the listing presented it as a measurement.
//
// Note every fixture here is UNOWNED - the ownership table owns nothing - so
// the ownership reading added in the next phase cannot quietly become the
// reason these pass.
describe("an unheard desk reports ignorance, not absence", () => {
  it("names the acquire flag when the machine's accessibility layer is switched off", async () => {
    const applications = await listing(
      { visibility: "all", accessibility: layerReporting("disabled") },
      wholeDesk("ordinary"),
    );

    // NOT not-answering. The census saw nothing because nothing could be
    // heard, and there is a setting that changes exactly that.
    expect(entry(applications, "hidden-from-menus").running).toBe("cannot-tell");
    expect(entry(applications, "hidden-from-menus").runningUnknownBy).toBe(ACQUIRE_SETTING);
  });

  it("names NOTHING when it could not find out whether the layer is on", async () => {
    // The guard against sending an operator to switch on something that was
    // never off. cannot-tell is what a failed read returns AND what an
    // unsupported platform returns; neither is evidence the layer is off.
    const applications = await listing(
      { visibility: "all", accessibility: layerReporting("cannot-tell") },
      wholeDesk("ordinary"),
    );

    expect(entry(applications, "hidden-from-menus").running).toBe("cannot-tell");
    expect(entry(applications, "hidden-from-menus").runningUnknownBy).toBeUndefined();
  });

  it("still reports a genuine absence when the desk demonstrably can be heard", async () => {
    // The qualification must not swallow the measurement it was added beside.
    const applications = await listing(
      { visibility: "all", accessibility: layerReporting("enabled") },
      wholeDesk("ordinary"),
    );

    expect(entry(applications, "hidden-from-menus").running).toBe("not-answering");
    expect(entry(applications, "hidden-from-menus").runningUnknownBy).toBeUndefined();
  });

  it("never degrades an application that actually answered", async () => {
    // A positive is a measurement. The layer's report and the census are read
    // at different moments, and a stale reading does not un-run an editor.
    const applications = await listing(
      { visibility: "all", accessibility: layerReporting("disabled") },
      wholeDesk("ordinary"),
    );

    expect(entry(applications, "ordinary").running).toBe("answering");
    expect(entry(applications, "ordinary").runningUnknownBy).toBeUndefined();
  });

  it("asks this session's own authority first, and names the grants file", async () => {
    // Pointing an unpermitted caller at the acquire flag would send them to
    // the wrong switch entirely: acquiring the layer would not let them look.
    const applications = await listing(
      { visibility: new Set(["something-else"]), accessibility: layerReporting("disabled") },
      wholeDesk("ordinary"),
    );

    expect(entry(applications, "ordinary").running).toBe("cannot-tell");
    expect(entry(applications, "ordinary").runningUnknownBy).toBe(OBSERVE_SETTING);
  });

  it("a daemon with no adapter at all says so, and blames no setting", async () => {
    // This daemon's own incompleteness is not a claim about the machine - the
    // same rule describeAccessibility already follows for the same reason.
    const applications = await listing({ visibility: "all", accessibility: undefined }, wholeDesk("ordinary"));

    expect(entry(applications, "hidden-from-menus").running).toBe("cannot-tell");
    expect(entry(applications, "hidden-from-menus").runningUnknownBy).toBeUndefined();
  });

  it("reads the layer once for the whole listing, not once per application", async () => {
    // A D-Bus round trip per entry across an inventory measured at 125 entries
    // would make listApplications unusable. The census beside it is already
    // asked once; so is this.
    const layer = layerReporting("disabled");
    const applications = await listing({ visibility: "all", accessibility: layer }, wholeDesk("ordinary"));

    expect(applications.length).toBeGreaterThan(1);
    expect(layer.reads).toBe(1);
  });
});

// A PROCESS THIS DAEMON CAN STILL SEE BREATHING IS NOT GONE.
//
// The second half of the same argument. The desk can be heard, the name is not
// on the tree, and this daemon started the process and can still verify it is
// alive. Restart already treats owned-process liveness as authoritative over
// tree absence; the listing now agrees with it.
//
// The boundary these tests exist to defend: this reading consults the OWNERSHIP
// TABLE and nothing else. An application a person launched by hand has no entry
// in it and is reported exactly as it was before. That invisibility is a product
// decision, not a gap.

// An ownership table that has really recorded a process, counting how often it
// was asked. Recording the daemon's own pid is the honest way to get a live,
// start-time-matching entry: it is a process that genuinely exists.
function tableOwning(...names: string[]): OwnershipTable & { asks: number } {
  const table = new OwnershipTable();
  for (const name of names) table.record(process.pid, name);
  const counted = table as OwnershipTable & { asks: number };
  counted.asks = 0;
  const ownsName = table.ownsName.bind(table);
  counted.ownsName = (name: string) => {
    counted.asks += 1;
    return ownsName(name);
  };
  return counted;
}

describe("an owned process this daemon can still verify is not reported gone", () => {
  it("reports cannot-tell, and names no setting, for an application it launched and can still see alive", async () => {
    // No setting fixes "I own it, it is alive, and it is not publishing" -
    // pointing a person at a file that cannot help is the mistake the bare
    // cannot-tell exists to avoid.
    const applications = await listing(
      { visibility: "all", table: tableOwning("hidden-from-menus"), accessibility: layerReporting("enabled") },
      wholeDesk("ordinary"),
    );

    expect(entry(applications, "hidden-from-menus").running).toBe("cannot-tell");
    expect(entry(applications, "hidden-from-menus").runningUnknownBy).toBeUndefined();
  });

  it("THE BOUNDARY: an application this daemon did not launch stays reported exactly as before", async () => {
    // The load-bearing test of this phase. The process in question is alive on
    // this very machine - it is this test runner - but the daemon owns it under
    // a DIFFERENT name, so nothing about `hidden-from-menus` may change. A
    // hand-launched application must not become observable through this path.
    const applications = await listing(
      { visibility: "all", table: tableOwning("something-else-entirely"), accessibility: layerReporting("enabled") },
      wholeDesk("ordinary"),
    );

    expect(entry(applications, "hidden-from-menus").running).toBe("not-answering");
    expect(entry(applications, "hidden-from-menus").runningUnknownBy).toBeUndefined();
  });

  it("a stale record whose process was replaced is not a live process", async () => {
    // Perturbing starttime rather than using a dead pid is deliberate: a dead
    // pid is indistinguishable from "no record at all" and would pass even if
    // the liveness check were deleted. A recycled pid is the case only the
    // start-time comparison catches.
    const table = tableOwning("hidden-from-menus");
    for (const owned of table.entries()) owned.starttime = `${Number(owned.starttime) + 1}`;

    const applications = await listing(
      { visibility: "all", table, accessibility: layerReporting("enabled") },
      wholeDesk("ordinary"),
    );

    expect(entry(applications, "hidden-from-menus").running).toBe("not-answering");
  });

  it("still reports answering when the census heard it, owned or not", async () => {
    const applications = await listing(
      { visibility: "all", table: tableOwning("ordinary"), accessibility: layerReporting("enabled") },
      wholeDesk("ordinary"),
    );

    expect(entry(applications, "ordinary").running).toBe("answering");
  });

  it("asks under the names the entry could have been launched as, not the id alone", async () => {
    // The entry is `hidden-from-menus`; the table recorded it under the `Name=`
    // the machine wrote, `Hidden From Menus`, which is one of the candidates
    // the census already derives. The same derivation answers the ownership
    // question, rather than a second answer to the same question - that
    // divergence is the whole subject of the segment after this one.
    const applications = await listing(
      { visibility: "all", table: tableOwning("Hidden From Menus"), accessibility: layerReporting("enabled") },
      wholeDesk("ordinary"),
    );

    expect(entry(applications, "hidden-from-menus").running).toBe("cannot-tell");
    expect(entry(applications, "hidden-from-menus").runningUnknownBy).toBeUndefined();
  });

  it("asks the ownership table once for the whole listing, not once per application", async () => {
    // ownsName does a synchronous readFileSync of /proc per matching record.
    // Once per installed entry per candidate name would put dozens of blocking
    // filesystem reads on the event loop inside a hot path.
    const table = tableOwning("hidden-from-menus");
    const applications = await listing(
      { visibility: "all", table, accessibility: layerReporting("enabled") },
      wholeDesk("ordinary"),
    );

    expect(applications.length).toBeGreaterThan(1);
    // One question per distinct OWNED name - never a function of how many
    // applications are installed.
    expect(table.asks).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import type { Channel } from "../channel.js";
import { UnrecordedExchangeError } from "../channel.js";
import { AtspiBackend } from "../index.js";
import { runningStateOf } from "../../../backend.js";

// What is ANSWERING, not what is installed (issue #53). The inventory reads
// desktop entries off the filesystem and can only say a thing exists; this
// census asks the bus which applications are on it right now.
//
// The three tests that matter are the three answers a caller can get, and the
// third one is the whole reason this is a census and not a list: a route with
// no view of a name must say so rather than report it closed.

const REGISTRY = "org.a11y.atspi.Registry";

// A scripted bus holding the named applications at its top level. Nothing
// below the applications is scripted, because the census never descends - the
// question is which applications answer, and that is read at the root.
function busHolding(names: string[], options: { unrecorded?: string } = {}): Channel {
  const paths = names.map((_, index) => `/org/a11y/atspi/accessible/${index + 10}`);
  return {
    async call(exchange) {
      const { member, path, destination } = exchange;
      if (member === "GetChildren") {
        if (destination === REGISTRY) return [paths.map((objectPath) => [":1.7", objectPath])];
        return [[]];
      }
      if (member === "Get") {
        const name = names[paths.indexOf(path)];
        if (name === options.unrecorded) throw new UnrecordedExchangeError(`nothing recorded for ${path}`);
        if (name === "__dead__") throw new Error("application exited mid-census");
        return [["s", [name]]];
      }
      throw new Error(`unexpected ${member}`);
    },
    async watch() {
      throw new Error("not used");
    },
    async close() {},
  };
}

describe("the census of what is answering on the bus", () => {
  it("reports an application on the bus as observable", async () => {
    const backend = new AtspiBackend(busHolding(["kate"]), "all");

    const census = await backend.runningApplications();

    expect(runningStateOf(census, "kate")).toBe("observable");
  });

  it("reports an application absent from a fully enumerated bus as not-observable", async () => {
    const backend = new AtspiBackend(busHolding(["kate"]), "all");

    const census = await backend.runningApplications();

    // Absence is a MEASUREMENT here, not a shrug: this route enumerated the
    // whole top level, so a name that is not on it is genuinely not answering.
    expect(census.answersFor).toBe("every-application");
    expect(runningStateOf(census, "mousepad")).toBe("not-observable");
  });

  it("says cannot-tell for a name the answering route has no view of", () => {
    // The browser route's shape, asserted against the reader every backend's
    // answer passes through: one name in view, and silence about the rest of
    // the machine rather than a claim that the rest of the machine is closed.
    const browser = { observable: new Set(["chromium"]), answersFor: new Set(["chromium"]) } as const;

    expect(runningStateOf(browser, "chromium")).toBe("observable");
    expect(runningStateOf(browser, "kate")).toBe("cannot-tell");
  });

  it("normalises the names it reports, exactly as the grants and inventory layers do", async () => {
    // Math-bold KATE. A census that skipped NFKC would answer not-observable
    // for the same application the grants file just permitted by its plain
    // name - two normalisation rules disagreeing inside one daemon.
    const backend = new AtspiBackend(busHolding(["\u{1D40A}\u{1D400}\u{1D413}\u{1D404}"]), "all");

    const census = await backend.runningApplications();

    expect(runningStateOf(census, "KATE")).toBe("observable");
  });

  it("counts an application that dies mid-census as not answering, and keeps the rest of the census", async () => {
    const backend = new AtspiBackend(busHolding(["__dead__", "kate"]), "all");

    const census = await backend.runningApplications();

    expect(runningStateOf(census, "kate")).toBe("observable");
    expect(census.observable.size).toBe(1);
  });

  it("refuses to answer at all when a reading is off the tape", async () => {
    // Ignorance under replay is not a dead application - it is the recording
    // being asked something it never saw. Swallowing it here would turn a gap
    // in the tape into "that application is not running".
    const backend = new AtspiBackend(busHolding(["kate"], { unrecorded: "kate" }), "all");

    await expect(backend.runningApplications()).rejects.toBeInstanceOf(UnrecordedExchangeError);
  });
});

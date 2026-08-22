import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { renderArtifact, verdictExit } from "../window-model.mjs";

// The harness's own guarantees. Everything here is about the SCORING - whether
// a verdict can be wrong while the run looks right - because that is the way a
// desktop proof fails silently (docs/05-TEST-STRATEGY.md:160-163, ADR-0012).

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "window-model.mjs");

const ENV = {
  when: "2026-08-22",
  host: "test",
  kernel: "test",
  commit: "testcommit",
};

function passingRows() {
  return [
    { box: 1, what: "managed", command: "xwininfo", observed: "no", verdict: "**pass**" },
    { box: 2, what: "above", command: "xprop", observed: "ABOVE", verdict: "**pass**" },
    { box: 3, what: "focused rival", command: "xprop", observed: "below", verdict: "**measured**" },
    { box: 4, what: "second output", command: "xwininfo", observed: "1084", verdict: "**pass**" },
  ];
}

describe("the exit code follows the verdicts", () => {
  it("is zero when every row passed", () => {
    expect(verdictExit(passingRows())).toBe(0);
  });

  it("is non-zero when a row failed", () => {
    const rows = passingRows();
    rows[3] = { ...rows[3], verdict: "**FAIL**" };
    // Wired into CI, a harness that exits 0 over an artifact full of FAIL rows
    // reports green. It did exactly that against a widget that restored no
    // placement at all.
    expect(verdictExit(rows)).not.toBe(0);
  });

  it("does not treat a measured-only row as a failure", () => {
    // Box 3 is reported rather than scored: the roadmap's one-line reading of
    // it is false and the artifact says what is true instead. A measured row
    // must not fail the run, or the honest reporting would have to be dropped
    // to keep the harness green.
    const rows = passingRows().filter((r) => r.verdict === "**measured**");
    expect(verdictExit(rows)).toBe(0);
  });
});

describe("the artifact cannot overclaim", () => {
  it("renders the measured box 3 condition", () => {
    const artifact = renderArtifact(passingRows(), ENV);
    expect(artifact).toContain("while that window holds focus");
  });

  it("refuses to be written claiming unconditional survival", () => {
    // ADR-0012: a proof that overclaims is worse than no proof. Box 3 does not
    // hold unconditionally, so the artifact must not be able to say it does.
    const rows = passingRows();
    rows[2] = {
      ...rows[2],
      what: "the face survives a full-screen window",
      verdict: "**pass**",
    };
    expect(() => renderArtifact(rows, ENV)).toThrow(/overclaim/i);
  });

  it("states its limitations before its results", () => {
    const artifact = renderArtifact(passingRows(), ENV);
    expect(artifact.indexOf("Limitations")).toBeLessThan(artifact.indexOf("## Measurements"));
  });

  it("names the tree it was measured against, dirt included", () => {
    // A bare hash on an artifact produced from a modified tree names a tree
    // that does not contain what was measured.
    const artifact = renderArtifact(passingRows(), { ...ENV, commit: "cc64174-dirty" });
    expect(artifact).toContain("cc64174-dirty");
  });

  it("refuses to render nothing at all", () => {
    // An artifact with an empty measurements table is the vacuous pass this
    // repository's pins exist to prevent.
    expect(() => renderArtifact([], ENV)).toThrow(/no measurements/i);
  });
});

describe("the harness refuses rather than guessing", () => {
  it("writes nothing without --live", () => {
    const run = spawnSync("node", [SCRIPT], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/refusing to write without --live/);
  });

  it("refuses a display that has no X server, naming it", () => {
    const run = spawnSync("node", [SCRIPT, "--live", "--display", "99"], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/no X server on :99/);
  });

  // Note deliberately absent: a test that the harness never reaches for a raw
  // input tool. Writing one means naming those tools here, and pin B8 then
  // reports THIS FILE as a reference outside the raw-input class - which it
  // did. The pin already makes that assertion over the whole tree, including
  // this harness, so a local copy would add nothing but a false violation.
});

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildRefusal,
  displayArg,
  isOverclaim,
  renderArtifact,
  unclearedActiveWindowRefusal,
  verdictExit,
} from "../window-model.mjs";

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

  it("refuses the same claim made without the words full-screen", () => {
    // The guard's first shape required the literal token `full-screen`, so the
    // BROADER claim - never buried by anything at all - walked straight past
    // the check written to stop the narrower one. A claim that says more than
    // the overclaim is not a smaller problem than the overclaim.
    for (const claim of [
      "the face is never buried by any window",
      "no window can cover the face",
      "the face stays on top of everything",
    ]) {
      const rows = passingRows();
      rows[2] = { ...rows[2], what: claim, verdict: "**pass**" };
      expect(() => renderArtifact(rows, ENV), claim).toThrow(/overclaim/i);
    }
  });

  it("judges the class, over every phrasing the claim has taken so far", () => {
    // Each rewrite of this guard was caused by ONE new phrasing walking past
    // it. Keeping the whole set here means the next rewrite has to keep every
    // earlier one caught, and has to keep the honest sentences renderable -
    // the failure mode of a widened guard is that it refuses the truth.
    for (const claim of [
      "the face survives a full-screen window",
      "the face is never buried by any window",
      "no window can cover the face",
      "the face stays on top of everything",
      "the face survives a full-screen window regardless of focus",
      "the face outranks a full-screen window",
      "the face wins against any window",
      "the face is always on top",
    ]) {
      expect(isOverclaim(claim), claim).toBe(true);
    }

    for (const honest of [
      "a focused full-screen window is above the face (the measured condition, ADR-0051)",
      "the face is not buried by a full-screen window that does not hold focus",
      "with no focused full-screen window, the face stays on top",
      "the face returns to the top of the stack when focus leaves the full-screen window",
    ]) {
      expect(isOverclaim(honest), honest).toBe(false);
    }
  });

  it("does not accept a claim merely for mentioning focus somewhere", () => {
    // The disclosure escape was any sentence containing the word focus. That
    // let a sentence deny the condition and be exempted by naming it: the
    // exemption must belong to a sentence that STATES the condition, not to
    // one that happens to carry the token.
    const rows = passingRows();
    rows[2] = {
      ...rows[2],
      what: "the face survives a full-screen window regardless of focus",
      verdict: "**pass**",
    };
    expect(() => renderArtifact(rows, ENV)).toThrow(/overclaim/i);
  });

  it("still allows the honest forms", () => {
    // The guard is worth nothing if it also refuses the true sentences: both
    // of these are what the measurement actually found.
    for (const honest of [
      "a focused full-screen window is above the face (the measured condition, ADR-0051)",
      "the face is not buried by a full-screen window that does not hold focus",
      // The negation here belongs to the CONDITION, not to the claim: this is
      // the artifact's own second box 3 row, and a guard that refuses it is a
      // guard that refuses the truth.
      "with no focused full-screen window, the face stays on top",
    ]) {
      const rows = passingRows();
      rows[2] = { ...rows[2], what: honest, verdict: "**measured**" };
      expect(() => renderArtifact(rows, ENV), honest).not.toThrow();
    }
  });

  it("states its limitations before its results", () => {
    const artifact = renderArtifact(passingRows(), ENV);
    expect(artifact.indexOf("Limitations")).toBeLessThan(artifact.indexOf("## Measurements"));
  });

  it("does not promote source witnesses into live desk measurements", () => {
    const artifact = renderArtifact(passingRows(), ENV);
    const prose = artifact.replace(/\s+/g, " ");
    expect(prose).toContain("Neither witness is silently promoted into the other");
    expect(prose).toContain("does not pretend 24 wall-clock hours elapsed");
    expect(artifact.indexOf("Limitations")).toBeLessThan(
      artifact.indexOf("What the desk row and the source witness each prove"),
    );
  });

  it("records why the dummy-driver desk replaced three one-display attempts", () => {
    const prose = renderArtifact(passingRows(), ENV).replace(/\s+/g, " ");
    expect(prose).toContain("xrandr --setmonitor");
    expect(prose).toContain("Xvfb XINERAMA");
    expect(prose).toContain("Xephyr with two screens");
    expect(prose).toContain("real CRTCs, the layer Chromium reads");
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

  it("returns the status its own header documents", () => {
    // The header drifted from the code once: it said 6 meant a single-headed
    // desk while the code returned 6 for measured failures and 7 for the desk.
    // Anyone reading a 6 in CI would have gone looking at the wrong thing. The
    // header is only worth having if it is checked, so every status the header
    // names is asserted here against what the code does with it.
    const header = readFileSync(SCRIPT, "utf8").split("import {")[0];
    const documented = new Set(
      [...header.matchAll(/^\/\/\s{3}(\d)\s{2}/gm)].map((m) => Number(m[1])),
    );
    expect(documented).toEqual(new Set([0, 2, 3, 4, 5, 6, 7]));

    // 6 is measured failures, not a desk problem.
    const failed = passingRows();
    failed[0] = { ...failed[0], verdict: "**FAIL**" };
    expect(verdictExit(failed)).toBe(6);
    expect(verdictExit(passingRows())).toBe(0);

    // 2 is a refusal before measuring, on all three of its causes.
    expect(spawnSync("node", [SCRIPT], { encoding: "utf8" }).status).toBe(2);
    expect(
      spawnSync("node", [SCRIPT, "--live", "--display", "99"], { encoding: "utf8" }).status,
    ).toBe(2);
    expect(buildRefusal(join(dirname(SCRIPT), "nope.mjs"))).not.toBeNull();
  });

  it("names an unbuilt widget as an unbuilt widget rather than as a missing window", () => {
    // The failure this separates: without the check, an unbuilt checkout waits
    // out the whole appearance budget and then reports "the widget never put a
    // window on the desk" with status 5 - a sentence that reads as a defect in
    // the face. The refusal must name the build and say how to fix it.
    const refusal = buildRefusal(join(dirname(SCRIPT), "no-such-bundle.mjs"));
    expect(refusal).toMatch(/not built/);
    expect(refusal).toMatch(/pnpm --filter @mastra-cc\/widget build/);
  });

  it("says nothing about a build that is there", () => {
    expect(buildRefusal(SCRIPT)).toBeNull();
  });

  it("refuses to measure box 2 on a desk whose active-window pointer did not clear", () => {
    // Clearing the pointer is only half of the guard. Without the half that
    // confirms the clear took, box 2's `before` can already name a window, and
    // the row then reads a real focus grab as "no change" - which is not a
    // failure to measure, it is a wrong answer that looks like a pass.
    const refusal = unclearedActiveWindowRefusal("0x600003");
    expect(refusal?.status).toBe(4);
    expect(refusal?.message).toMatch(/0x600003/);
    expect(refusal?.message).toMatch(/decision 2 cannot be measured here/);
  });

  it("says nothing when the pointer did clear", () => {
    expect(unclearedActiveWindowRefusal(null)).toBeNull();
  });
});

describe("the display argument", () => {
  // Both spellings are in the tree's own documents: the plan wrote
  // `--display :82`, the progress file wrote `up :84`, and the tests wrote
  // `--display 99`. Two files by two authors made the same mistake, so the
  // fix is to accept both spellings rather than to correct the callers.
  it("accepts a display written with a colon, the way DISPLAY itself is written", () => {
    expect(displayArg(["--live", "--display", ":84"])).toBe("84");
  });

  it("accepts a bare display number", () => {
    expect(displayArg(["--live", "--display", "84"])).toBe("84");
  });

  it("defaults when no display is named", () => {
    expect(displayArg(["--live"])).toBe("83");
  });

  it("refuses a --display with nothing after it rather than measuring :undefined", () => {
    expect(() => displayArg(["--live", "--display"])).toThrow(/--display needs a display number/);
  });

  it("refuses a display that is not a number", () => {
    expect(() => displayArg(["--live", "--display", "eighty-four"])).toThrow(
      /--display needs a display number/,
    );
  });

  it("reports the flag with no value as a refusal, not as a missing X server", () => {
    const run = spawnSync("node", [SCRIPT, "--live", "--display"], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/--display needs a display number/);
  });

  it("names a colon-written display without doubling the colon", () => {
    const run = spawnSync("node", [SCRIPT, "--live", "--display", ":99"], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/no X server on :99 /);
  });

  // Note deliberately absent: a test that the harness never reaches for a raw
  // input tool. Writing one means naming those tools here, and pin B8 then
  // reports THIS FILE as a reference outside the raw-input class - which it
  // did. The pin already makes that assertion over the whole tree, including
  // this harness, so a local copy would add nothing but a false violation.
});

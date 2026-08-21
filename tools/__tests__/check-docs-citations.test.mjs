import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The citation check, against a scratch tree so no case touches the real one.
//
// WHY IT EXISTS. M3's whole-feature review found the same false citation four
// times across four rounds - three ADRs and then a fourth in a different key -
// each one found by a person reading, each after the previous round's fix had
// been called complete. The reviewer's own closing note is the brief for this
// file: the fifth copy should be found by a tool, not by a reader. Wiring the
// check found five more the same day.
//
// The cases below are the four historical sites plus the two ways the check
// could pass while meaning nothing: judging nothing at all, and an exemption
// wide enough to swallow the defect it was carved out for.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const check = join(repoRoot, "scripts", "check-docs.mjs");

let root;

/**
 * The check walks from its own location, so a scratch tree has to be a whole
 * miniature repository: the documents it requires, an ADR index, a proofs
 * index. Everything here exists to let the citation check be the only thing
 * that can go red.
 */
function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), "check-docs-citations-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "docs", "02-DECISIONS"), { recursive: true });
  mkdirSync(join(dir, "docs", "proofs"), { recursive: true });
  mkdirSync(join(dir, "protocol"), { recursive: true });

  cpSync(check, join(dir, "scripts", "check-docs.mjs"));
  cpSync(join(repoRoot, "protocol", "schema.json"), join(dir, "protocol", "schema.json"));

  for (const name of [
    "00-PRODUCT", "01-ARCHITECTURE", "03-LESSONS", "04-INTEGRATION-PLAN",
    "05-TEST-STRATEGY", "06-OPERATIONS", "07-ROADMAP", "08-GLOSSARY", "09-QUESTIONS",
  ]) {
    writeFileSync(join(dir, "docs", `${name}.md`), `# ${name}\n`);
  }
  writeFileSync(join(dir, "README.md"), "# scratch\n");
  writeFileSync(join(dir, "CONTRIBUTING.md"), "# contributing\n");
  writeFileSync(
    join(dir, "docs", "02-DECISIONS", "README.md"),
    "# Decisions\n\n- [0001](0001-a-record.md)\n",
  );
  writeFileSync(
    join(dir, "docs", "proofs", "README.md"),
    "# Proofs\n\n- [a measurement](a-measurement.md)\n",
  );
  writeFileSync(join(dir, "docs", "proofs", "a-measurement.md"), "# a measurement\n");
  return dir;
}

/**
 * Write the one ADR whose citation each case is about.
 *
 * Every case keeps one citation that is true, because a case whose document
 * cites nothing at all trips the vacuity guard and reds for a reason that has
 * nothing to do with what the case is asserting. Two of these cases were
 * written without it and failed exactly that way, which is the guard working.
 */
function record(body) {
  const trueCitation = "\nThe wire's capabilities are `capabilityNames` in `protocol/schema.json`.\n";
  writeFileSync(join(root, "docs", "02-DECISIONS", "0001-a-record.md"), `${body}\n${trueCitation}`);
}

function run() {
  return spawnSync(process.execPath, [join(root, "scripts", "check-docs.mjs")], { encoding: "utf8" });
}

beforeEach(() => {
  root = scratchRepo();
  record("# 0001\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the citation check", () => {
  it("passes when a document cites a name the file actually carries", () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ok -");
  });

  it("reds on the citation four review rounds each found by hand", () => {
    // ADR-0008, ADR-0034, ADR-0021 and - in a different key - ADR-0043 all
    // cited a container the schema has never had. `git log -S'enums' --
    // protocol/schema.json` returns nothing: no commit in this repository's
    // history has ever put one there.
    record("# 0001\n\nThe five operation classes live in `protocol/schema.json` under `enums.operationClass`.\n");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("cites `enums.operationClass` in `protocol/schema.json`, which contains no `enums`");
  });

  it("reds on the fourth copy's different key, not just the phrase the first three shared", () => {
    // The fourth site said `enums.action`, not `enums.operationClass`. A check
    // that matched the string three rounds had taught it would read this as
    // clean - which is exactly how it survived to a fourth round.
    record("# 0001\n\nThe action names are `protocol/schema.json`, `enums.action`.\n");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("cites `enums.action` in `protocol/schema.json`, which contains no `enums`");
  });

  it("allows a loose name for a real key rather than demanding the whole path", () => {
    // `action.name` resolves at types.action.fields.name. The document is
    // telling the truth about the shape and naming it loosely, and a check
    // that reddens here is one people delete.
    record("# 0001\n\nAn action carries `action.name` verbatim, per `protocol/schema.json`.\n");
    expect(run().status).toBe(0);
  });

  it("allows a vocabulary member, which is a value rather than a key", () => {
    // `launch` is a member of capabilityNames, not a key. Citing it is right.
    record("# 0001\n\n`protocol/schema.json` carries `launch` among the capabilities.\n");
    expect(run().status).toBe(0);
  });

  it("exempts a line that quotes a false citation in order to correct it", () => {
    // Every correction has to quote the wrong citation to say it is wrong.
    // A check that reddens on its own fixes is a check that cannot be obeyed.
    record("# 0001\n\n**Corrected 2026-08-21.** This record said `protocol/schema.json` carries `enums.operationClass`. There is no such object.\n");
    expect(run().status).toBe(0);
  });

  it("does not let that exemption swallow the defect it was carved out for", () => {
    // THE CASE THE EXEMPTION IS DANGEROUS FOR. Same false citation, same
    // paragraph shape, without the language of a correction. If this passes,
    // the exemption is a hole rather than a carve-out.
    record("# 0001\n\n**Where they live.** They are enumerated in `protocol/schema.json` under `enums.operationClass`.\n");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("which contains no `enums`");
  });

  it("does not let one corrected row darken the rest of its table", () => {
    // A markdown table has no blank line in it, so a block-scoped exemption
    // reads the WHOLE table as one excused paragraph: correct one row and
    // every other row goes permanently unjudged. Five real evidence tables
    // were dark this way, including one whose neighbouring row carried a live
    // false citation. The corrected row is excused; its neighbours are not.
    record(
      "# 0001\n\n| Claim | Source |\n|---|---|\n" +
        "| the classes | **Not** in `protocol/schema.json` under `enums.operationClass` - corrected 2026-08-21 |\n" +
        "| the methods | `protocol/schema.json`, `launchApplication` |\n",
    );
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("which contains no `launchApplication`");
    // ...and the corrected row is still excused, or the check eats its own tail.
    expect(r.stdout).not.toContain("which contains no `enums`");
  });

  it("excuses a prose correction whose disclaimer wraps onto the next line", () => {
    // The counterpart to the table case: prose hard-wraps, so a correction can
    // state the false citation on one line and say it is false on the next.
    // Row-scoping BOTH shapes would redden every prose correction in the tree.
    record(
      "# 0001\n\nADR-0008 claimed the classes are enumerated in `protocol/schema.json`\n" +
        "under `enums.operationClass`. No schema here has ever carried one, and the\n" +
        "citation was corrected 2026-08-21.\n",
    );
    const r = run();
    expect(r.status).toBe(0);
  });

  it("reads a citation whose path and name sit on different lines", () => {
    // Prose hard-wraps, and one of the four sites states its citation with the
    // path ending one line and the name opening the next. A line-scoped
    // version of this check reads that site as clean.
    record("# 0001\n\nThe classes are enumerated in `protocol/schema.json` under\n`enums.operationClass`, and that is where they are.\n");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("which contains no `enums`");
  });

  it("ignores a name that merely shares a paragraph with a file it does not belong to", () => {
    // Measured on the real tree: genuine citations sit within ninety
    // characters, and coincidental pairings - a roadmap paragraph naming
    // `tools/mutations.json` and, four thousand characters later, a
    // platform method - sit far outside. A check that reddens on those is
    // noise, and noise gets switched off.
    record(
      `# 0001\n\n\`protocol/schema.json\` is frozen. ${"Some intervening prose that goes on at length. ".repeat(6)}Elsewhere the platform publishes \`Component.GrabFocus\`.\n`,
    );
    expect(run().status).toBe(0);
  });

  it("refuses to pass when it judged nothing at all", () => {
    // Vacuity. This repository documents its protocol by naming things in it;
    // a run that examined no citation is a broken check, not a clean tree.
    // Written directly rather than through `record`, because `record` keeps a
    // true citation in every document precisely so this cannot fire by
    // accident in the other cases.
    writeFileSync(join(root, "docs", "02-DECISIONS", "0001-a-record.md"), "# 0001\n\nA record that cites nothing.\n");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("the check examined nothing");
  });

  it("says nothing about a JSON file it cannot parse, rather than guessing", () => {
    writeFileSync(join(root, "protocol", "broken.json"), "{ this is not json");
    record("# 0001\n\nSee `protocol/broken.json` under `enums.whatever`.\n");
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("broken.json");
  });

  it("leaves a missing file to the dead-link check rather than reporting it twice", () => {
    record("# 0001\n\nSee `protocol/absent.json` under `enums.whatever`.\n");
    const r = run();
    expect(r.status).toBe(0);
    expect(readFileSync(join(root, "docs", "02-DECISIONS", "0001-a-record.md"), "utf8")).toContain("absent.json");
  });
});

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
  // A document with a citable line on it, for the true line citation every
  // case carries. 06-OPERATIONS is the one no case rewrites.
  writeFileSync(join(dir, "docs", "06-OPERATIONS.md"), "# 06-OPERATIONS\n\n**A fact.** Which this line states.\n");
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
 * Every case keeps one citation of EACH kind that is true, because a case whose
 * document cites nothing at all trips a vacuity guard and reds for a reason
 * that has nothing to do with what the case is asserting. Two of these cases
 * were written without the first and failed exactly that way; adding the line
 * check reproduced it across nine more. The guard working, twice.
 */
function record(body) {
  const trueCitation =
    "\nThe wire's capabilities are `capabilityNames` in `protocol/schema.json`," +
    " and the fact is at `docs/06-OPERATIONS.md:3`, as ADR-0001 says.\n";
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

  it("names the line the citation is on, not the line its table starts on", () => {
    // The report is what a person opens the file at. A table is one block, so
    // a block-scoped line number sends every row of a long evidence table to
    // the table's first line: the real tree's worst case pointed at `:46` for
    // a citation on `:54`. Reporting a line nobody can follow is the same
    // defect as a message that truncates what it found.
    record(
      "# 0001\n\n| Claim | Source |\n|---|---|\n" +
        "| one | nothing to see |\n| two | nothing to see |\n| three | nothing to see |\n" +
        "| four | `protocol/schema.json`, `launchApplication` |\n",
    );
    const r = run();
    expect(r.status).toBe(1);
    // The table opens on line 3 (header), 4 is its separator, and the false
    // citation is the fourth data row: line 8.
    expect(r.stdout).toContain("0001-a-record.md:8: cites `launchApplication`");
    expect(r.stdout).not.toContain("0001-a-record.md:3:");
  });

  it("excuses a prose correction whose disclaimer wraps onto the next line", () => {
    // The counterpart to the table case: prose hard-wraps, so a correction can
    // state the false citation on one line and say it is false on the next.
    // Row-scoping BOTH shapes would redden every prose correction in the tree.
    record(
      "# 0001\n\nAn earlier record claimed the classes are enumerated in `protocol/schema.json`\n" +
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
    // Names THIS guard, not the shared tail. Two vacuity guards now print the
    // same closing sentence, so asserting on "examined nothing" let the line
    // guard answer for the deleted key guard - and the mutation survived.
    expect(r.stdout).toContain("no document cites a key in a JSON file");
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

/**
 * The second citation key: `some/file.md:41`.
 *
 * WHY IT EXISTS. The key above catches a document naming something a file has
 * never contained. It cannot catch a citation that was true when it was
 * written and drifted, because the name it cites is a LINE NUMBER and every
 * line number is real. ADR-0046 struck a clause in ADR-0004 and, in the same
 * commit, inserted two lines above it - so its own three back-references, the
 * B8 pin's comment, the pin's violation message and the pins README all
 * pointed two lines short of the claim they named. Six sites, one edit, and a
 * green gate the whole time. Found by hand on 2026-08-21, which is the thing
 * this file exists to stop happening twice.
 *
 * The machine-checkable core: a cited line that is BLANK, or a bare heading,
 * or a table rule, cannot be carrying a claim. That is a weak assertion by
 * design - it is the part that is true without a human judging prose - and it
 * caught all seven live sites in this repository.
 */
describe("the line-citation check", () => {
  function target(lines) {
    writeFileSync(join(root, "docs", "05-TEST-STRATEGY.md"), lines.join("\n"));
  }

  it("passes when a cited line carries something", () => {
    target(["# strategy", "", "**A rule.** Which this line states.", ""]);
    record("# 0001\n\nThe rule is at `docs/05-TEST-STRATEGY.md:3`.\n");
    const r = run();
    expect(r.status).toBe(0);
  });

  it("reds when a citation lands on a blank line", () => {
    target(["# strategy", "", "**A rule.** Which this line states.", ""]);
    record("# 0001\n\nThe rule is at `docs/05-TEST-STRATEGY.md:2`.\n");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("docs/05-TEST-STRATEGY.md:2");
    expect(r.stdout).toContain("blank line");
  });

  it("reds when a citation lands on a bare heading, naming the line it landed on", () => {
    // The real shape of the drift: the claim moved down, the citation stayed,
    // and it now points at the section header above it. A reader following it
    // finds a title where they were promised a rule.
    target(["# strategy", "", "### Four rules for writing one", "", "**1. A rule.**"]);
    record("# 0001\n\nSee `docs/05-TEST-STRATEGY.md:3`.\n");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Four rules for writing one");
  });

  it("says nothing about a line number past the end of the file", () => {
    // Out of range is a different defect and belongs to whoever reports dead
    // links; reporting it here would double-count and teach people to skim
    // this check's output.
    target(["# strategy", "", "**A rule.**"]);
    record("# 0001\n\nSee `docs/05-TEST-STRATEGY.md:900`.\n");
    expect(run().status).toBe(0);
  });

  it("reads the source files that cite documents, not only the documents", () => {
    // FOUR OF THE SEVEN LIVE SITES WERE IN SOURCE. A pin's header comment
    // citing the ADR it enforces, a violation message quoting that ADR to the
    // person who tripped it, a proof script naming the rules it holds itself
    // to - all of them drifted with the same edit, and a check that walks
    // markdown alone would have called that tree clean. It nearly did: the
    // first bite of this check on the real repository passed, because the
    // stale citation it was aimed at lived in `tools/pins/b8.mjs`.
    target(["# strategy", "", "### A heading", "", "**A rule.**"]);
    mkdirSync(join(root, "tools"), { recursive: true });
    writeFileSync(
      join(root, "tools", "a-gate.mjs"),
      "// The rule this enforces is at docs/05-TEST-STRATEGY.md:3.\nexport const gate = true;\n",
    );
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("tools/a-gate.mjs:1");
    expect(r.stdout).toContain("A heading");
  });

  it("resolves the shorthand this corpus actually uses", () => {
    // `0004:45` and `ADR-0046:46`, not `docs/02-DECISIONS/0004-....md:45`.
    // TWELVE of the repository's line citations are written this way and
    // ALL SIX SITES OF THE DEFECT THAT PROMPTED THIS CHECK were - so a check
    // that only understood full paths would have watched the whole incident
    // go by. Its first bite on the real tree did exactly that: the stale
    // citation it was aimed at read `0004:32`, and the check passed.
    writeFileSync(
      join(root, "docs", "02-DECISIONS", "0002-another.md"),
      "# 0002\n\n### A heading\n\n**A rule.** Which this line states.\n",
    );
    writeFileSync(
      join(root, "docs", "02-DECISIONS", "README.md"),
      "# Decisions\n\n- [0001](0001-a-record.md)\n- [0002](0002-another.md)\n",
    );
    record("# 0001\n\nThe rule is at `0002:3`.\n");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("`0002:3`");
    expect(r.stdout).toContain("A heading");
  });

  it("reds when a citation lands on a struck clause", () => {
    // The exact shape of the ADR-0046 incident, and the one part of it a
    // machine can judge without reading prose: struck text is text the
    // repository has explicitly retired, so a live citation pointing INTO it
    // is either stale or is quoting a correction - and a correction says so
    // in the words around it, which is the exemption below.
    writeFileSync(
      join(root, "docs", "02-DECISIONS", "0002-another.md"),
      "# 0002\n\n- ~~**A banned thing.**~~ struck by a later record.\n\n**The live rule.**\n",
    );
    writeFileSync(
      join(root, "docs", "02-DECISIONS", "README.md"),
      "# Decisions\n\n- [0001](0001-a-record.md)\n- [0002](0002-another.md)\n",
    );
    record("# 0001\n\nThe ban is stated at `0002:3`.\n");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("struck");
  });

  it("lets a record quote the struck clause it is striking", () => {
    // ADR-0046 cites ADR-0004's struck ban on purpose, to say what it struck.
    // Reddening that is the check eating its own tail - the same exemption
    // the name-citation check needed, for the same reason.
    writeFileSync(
      join(root, "docs", "02-DECISIONS", "0002-another.md"),
      "# 0002\n\n- ~~**A banned thing.**~~ struck by a later record.\n\n**The live rule.**\n",
    );
    writeFileSync(
      join(root, "docs", "02-DECISIONS", "README.md"),
      "# Decisions\n\n- [0001](0001-a-record.md)\n- [0002](0002-another.md)\n",
    );
    record("# 0001\n\nThis record struck the ban stated at `0002:3`.\n");
    expect(run().status).toBe(0);
  });

  it("refuses to pass when it resolved no line citation at all", () => {
    // Same vacuity doctrine as every other gate here. The `.mastracode` skip
    // and a corpus that stopped citing lines would both silence this check;
    // silence has to be loud.
    target(["# strategy", "", "**A rule.**"]);
    writeFileSync(
      join(root, "docs", "02-DECISIONS", "0001-a-record.md"),
      "# 0001\n\nThe wire's capabilities are `capabilityNames` in `protocol/schema.json`.\n",
    );
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("no document cites a line");
  });
});

describe("the named-record check", () => {
  // WHY IT EXISTS. Segment 1 shipped two files citing `ADR-0051` by name, in
  // prose, as the record explaining a measured condition. There was no ADR-0051.
  // Every check in this file passed: the dead-link check saw no link, the ADR
  // index check saw a contiguous 0001-0050 with nothing missing, the citation
  // checks judge JSON keys and line numbers and neither one was involved. A
  // human reviewer found it by reading.
  //
  // The gap is precise. A citation written as a LINK is checked, and a citation
  // written as a LINE is checked, but a record named in running prose - the
  // form an author reaches for first - was invisible.

  function decisions(entries) {
    // entries: [number, filename] pairs that exist on disk and in the index.
    const lines = ["# Decisions", ""];
    for (const [n, file] of entries) {
      lines.push(`- [${String(n).padStart(4, "0")}](${file})`);
    }
    writeFileSync(join(root, "docs", "02-DECISIONS", "README.md"), `${lines.join("\n")}\n`);
  }

  it("passes when a document names a record that exists", () => {
    record("# 0001\n\nThe reason is recorded in ADR-0001.\n");
    expect(run().status).toBe(0);
  });

  it("reds when a document names a record that does not exist", () => {
    record("# 0001\n\nThe measured condition is recorded in ADR-0051.\n");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("ADR-0051");
    expect(r.stdout).toContain("no such record");
  });

  it("names the file and line the dead reference is on", () => {
    // A report that says only "ADR-0051 does not exist" sends the reader
    // grepping. The thirteenth finding of this class was that an error naming
    // the block instead of the row is a report nobody can follow.
    // Line 1 is the heading, 2 blank, 3 the filler line, 4 blank, 5 the
    // reference. Counted wrong on the first write, which is why the assertion
    // pins the number rather than the sentence.
    record("# 0001\n\nA line.\n\nThe condition is recorded in ADR-0051.\n");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("docs/02-DECISIONS/0001-a-record.md:5");
  });

  it("reads the source files that name records, not only the documents", () => {
    // Both live sites were in `tools/proofs/window-model.mjs` - a comment and a
    // measurement label. Markdown-only walking would have called that clean,
    // which is exactly what the line-citation check learned the hard way.
    mkdirSync(join(root, "tools"), { recursive: true });
    writeFileSync(
      join(root, "tools", "a-harness.mjs"),
      "// Both halves are reported. ADR-0051 records why.\nexport const harness = true;\n",
    );
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("tools/a-harness.mjs:1");
    expect(r.stdout).toContain("ADR-0051");
  });

  it("says nothing about a record named inside a resolvable link", () => {
    // `[ADR-0002](0002-another.md)` is the dead-link check's business. Judging
    // it here would double-report the same defect in two voices.
    writeFileSync(
      join(root, "docs", "02-DECISIONS", "0002-another.md"),
      "# 0002\n\n**A rule.**\n",
    );
    decisions([[1, "0001-a-record.md"], [2, "0002-another.md"]]);
    record("# 0001\n\nSee [ADR-0002](0002-another.md).\n");
    expect(run().status).toBe(0);
  });

  it("judges the number, not the four digits next to it", () => {
    // `M4 segment 1` and `PR #228` and `0004:45` are not record names. A check
    // that reddens on those is one people delete.
    record("# 0001\n\nM4 segment 1, PR #228, and the rule at `0001:3`.\n");
    expect(run().status).toBe(0);
  });

  it("refuses to pass when it judged no named record at all", () => {
    // Same vacuity doctrine as the two checks above it. A corpus that stopped
    // naming records in prose, or a walker that stopped reaching them, must be
    // loud rather than green.
    writeFileSync(
      join(root, "docs", "02-DECISIONS", "0001-a-record.md"),
      "# 0001\n\nThe capabilities are `capabilityNames` in `protocol/schema.json`," +
        " and the fact is at `docs/06-OPERATIONS.md:3`.\n",
    );
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("no document names a record");
  });
});

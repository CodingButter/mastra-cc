import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The contract gate is exercised two ways. Planted-tree cases prove each defect
// produces its own named failure. The real-tree case (no --root) is the one that
// makes `node tools/mutations.mjs` meaningful: a documentation mutation only goes
// red if some test actually reads docs/10-NORTH-STAR-CONTRACT.md.

const toolsDir = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const checker = join(toolsDir, "contract-check.mjs");
const DOC = "docs/10-NORTH-STAR-CONTRACT.md";
const real = readFileSync(join(repoRoot, DOC), "utf8");

function run(args = []) {
  const result = spawnSync(process.execPath, [checker, ...args], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

// Plant a copy of the real contract with one defect applied, so every planted
// case differs from a passing document by exactly the thing under test.
function plant(mutate) {
  const root = mkdtempSync(join(tmpdir(), "contract-check-test-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, DOC), mutate(real));
  return root;
}

function rowOf(text, id) {
  const line = text.split("\n").find((l) => l.startsWith(`| ${id} |`));
  if (!line) throw new Error(`fixture is stale: no row ${id}`);
  return line;
}

test("a planted copy of the real contract passes", () => {
  const { status, output } = run(["--root", plant((t) => t)]);
  expect(status, output).toBe(0);
  expect(output).toContain("34 rows");
});

test("the real document passes with no --root", () => {
  const { status, output } = run();
  expect(status, output).toBe(0);
  expect(output).toContain("contract-check: ok - 34 rows");
  expect(output).toContain("S-SUCCESS-R2A");
});

test("a missing document fails as vacuous rather than passing", () => {
  const empty = mkdtempSync(join(tmpdir(), "contract-check-empty-"));
  const { status, output } = run(["--root", empty]);
  expect(status).toBe(1);
  expect(output).toContain("the check would pass vacuously");
});

test("a document with no matrix header fails as vacuous", () => {
  const root = plant((t) => t.split("\n").filter((l) => !l.includes("| id |")).join("\n"));
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain("no acceptance-matrix header found");
});

test("a matrix header with no rows fails as vacuous", () => {
  const root = plant((t) => t.split("\n").filter((l) => !l.startsWith("| S-")).join("\n"));
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain("acceptance matrix has no rows");
});

test("a deleted row is reported as a missing required id", () => {
  const root = plant((t) => t.replace(`${rowOf(t, "S-EMPTY-INBOX")}\n`, ""));
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain("missing required row id S-EMPTY-INBOX");
});

test("a renamed row is reported as an unknown id", () => {
  const root = plant((t) => t.replace("| S-EMPTY-INBOX |", "| S-NOT-A-REAL-ROW |"));
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain("unknown row id S-NOT-A-REAL-ROW");
});

test("a repeated row is reported as a duplicate id", () => {
  const root = plant((t) => {
    const row = rowOf(t, "S-EMPTY-INBOX");
    return t.replace(`${row}\n`, `${row}\n${row}\n`);
  });
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain("duplicate row id S-EMPTY-INBOX");
});

test("an emptied cell is reported by column name", () => {
  const root = plant((t) => {
    const row = rowOf(t, "S-EMPTY-INBOX");
    const cells = row.split("|");
    cells[8] = "  ";
    return t.replace(row, cells.join("|"));
  });
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain('S-EMPTY-INBOX has an empty "next permitted recovery" cell');
});

test("an unbound audit count is rejected", () => {
  const root = plant((t) => {
    const row = rowOf(t, "S-EMPTY-INBOX");
    return t.replace(row, row.replace("| 0 |", "| exactly N (answer elements) |"));
  });
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain("answer audit \"exactly N (answer elements)\" is not 0");
});

test("a disposition outside the frozen enum is rejected", () => {
  const root = plant((t) => {
    const row = rowOf(t, "S-EMPTY-INBOX");
    return t.replace(row, row.replace("| completed — spoken |", "| finished somehow |"));
  });
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain("is not one of the four frozen values");
});

test("a success cardinality that contradicts R6 is rejected", () => {
  const root = plant((t) => {
    const row = rowOf(t, "S-SUCCESS-R2A");
    return t.replace(row, row.replace("| exactly 3 (", "| exactly 5 ("));
  });
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain('S-SUCCESS-R2A answer audit must be "exactly 3 (<roles>)"');
});

test("a removed rule identifier is reported", () => {
  const root = plant((t) => t.replace(/\bR3\b/g, "the denylist"));
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain("rule identifier R3 is absent");
});

test("a removed prose decision is reported", () => {
  const root = plant((t) => t.replace("The allowlist is closed", "The allowlist is flexible"));
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain("closed ordering allowlist");
});

test("an escaped pipe is refused rather than guessed at", () => {
  const root = plant((t) => t.replace("| S-EMPTY-INBOX |", "| S-EMPTY-INBOX \\| |"));
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain("an escaped pipe appears in the document");
});

test("a refusal outcome that cites no R7 class is rejected", () => {
  const root = plant((t) => {
    const row = rowOf(t, "S-EMPTY-INBOX");
    return t.replace(row, row.replace("R7d refusal:", "refusal:"));
  });
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain("must cite its frozen refusal class R7d");
});

// R7g never says the word "refusal", so a word-match check would have left these
// rows free to drift. The frozen per-row class is what closes that.
test("a failure row that drops its R7g citation is rejected", () => {
  const root = plant((t) => {
    const row = rowOf(t, "S-PROVIDER-FAIL-BEFORE-DISPATCH");
    return t.replace(row, row.replace("R7g failure:", "failure:"));
  });
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain("S-PROVIDER-FAIL-BEFORE-DISPATCH spoken outcome must cite its frozen refusal class R7g");
});

test("a refusal row citing the wrong R7 class is rejected", () => {
  const root = plant((t) => {
    const row = rowOf(t, "S-EMPTY-INBOX");
    return t.replace(row, row.replace("R7d refusal:", "R7e refusal:"));
  });
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain("cites R7e but its frozen class is R7d");
});

test("a non-refusal row that claims an R7 class is rejected", () => {
  const root = plant((t) => {
    const row = rowOf(t, "S-DISMISS-DURING-WORK");
    return t.replace(row, row.replace("| Nothing from the dismissed request", "| R7e refusal: nothing from the dismissed request"));
  });
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain("S-DISMISS-DURING-WORK is not a refusal row but its spoken outcome cites R7e");
});

test("a duplicated matrix column is rejected", () => {
  const root = plant((t) =>
    t
      .split("\n")
      .map((l) => (l.startsWith("| id |") ? `${l} answer audit |` : l))
      .join("\n"),
  );
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain('matrix header repeats the "answer audit" column');
});

test("an extra column in the header is rejected", () => {
  const root = plant((t) =>
    t
      .split("\n")
      .map((l) => (l.startsWith("| id |") ? `${l} notes |` : l))
      .join("\n"),
  );
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain("matrix header has 10 columns, expected exactly 9");
});

test("a row with an extra cell is rejected", () => {
  const root = plant((t) => {
    const row = rowOf(t, "S-EMPTY-INBOX");
    return t.replace(row, `${row} spare |`);
  });
  const { status, output } = run(["--root", root]);
  expect(status).toBe(1);
  expect(output).toContain("S-EMPTY-INBOX has 10 cells, expected exactly 9");
});

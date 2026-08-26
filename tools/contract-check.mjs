import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// CI step: the M6 north-star contract is machine-checked, not merely written.
// docs/10-NORTH-STAR-CONTRACT.md is the single authority for what "Tell me my
// most recent email" means (M6 Stage 1). Prose decays; this gate fails when a
// required scenario row, a frozen column value, the audit grammar, or a rule
// identifier is removed.
//
// This is deliberately NOT a tools/pins/bN.mjs file: the pin namespace is the
// twelve architectural boundaries B1-B12, and a contract-drift check is not a
// thirteenth boundary.
//
// Usage: node tools/contract-check.mjs [--root <dir>]

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const root = arg("--root") ?? fileURLToPath(new URL("..", import.meta.url));
const DOC = "docs/10-NORTH-STAR-CONTRACT.md";

const REQUIRED_IDS = [
  "S-SUCCESS-R2A",
  "S-SUCCESS-R2B",
  "S-SIGNED-OUT",
  "S-NO-INBOX-VIEW",
  "S-MAILBOX-AMBIGUOUS-WINDOWS",
  "S-CATEGORY-NONE-SELECTED",
  "S-CATEGORY-ONE-SELECTED",
  "S-EMPTY-INBOX",
  "S-ZERO-ROWS-NO-EMPTY-STATE",
  "S-ORDERING-ABSENT",
  "S-ORDERING-INADMISSIBLE-POSINSET",
  "S-ORDERING-LABEL-NOT-ABSOLUTE",
  "S-ORDERING-TIE",
  "S-CANDIDATE-AMBIGUOUS",
  "S-CANDIDATE-STALE",
  "S-FIELD-ASSOCIATION-FAILURE",
  "S-SUBJECT-EMPTY-PUBLISHED",
  "S-SUBJECT-UNREADABLE",
  "S-SENDER-ADDRESS-ONLY",
  "S-SENDER-ABSENT",
  "S-TRAVERSAL-EXHAUSTED",
  "S-GMAIL-UNPERMITTED",
  "S-GMAIL-NOT-RUNNING",
  "S-GMAIL-UNREADABLE",
  "S-DAEMON-REFUSAL-BEFORE-READ",
  "S-DAEMON-REFUSAL-PARTIAL",
  "S-PROVIDER-FAIL-BEFORE-DISPATCH",
  "S-PROVIDER-FAIL-AFTER-DISPATCH",
  "S-DISMISS-BEFORE-DISPATCH",
  "S-DISMISS-DURING-WORK",
  "S-DISMISS-DURING-SPEECH",
  "S-LATE-RESULT-AFTER-DISMISSAL",
  "S-INACTIVITY-CLOSE",
  "S-DECLINE-FOLLOW-UP",
];

const COLUMNS = [
  "id",
  "scenario",
  "precondition / measured signal",
  "spoken outcome",
  "voice / session end state",
  "background-request disposition",
  "answer audit",
  "next permitted recovery",
  "replay-representable",
];

const DISPOSITIONS = new Set([
  "none-dispatched",
  "unobservable-by-design — never spoken",
  "completed — spoken",
  "completed — withheld, disclosure requires fresh correlation",
]);

// Every row's outcome class is frozen here rather than inferred from the prose.
// "Refusal" is not a word-match: a row whose class is R7a-R7g must cite exactly
// that class, and a row that is not a refusal must cite none of them - which is
// what keeps R7g (a failure that never says "refusal") from drifting unguarded.
const OUTCOME_CLASS = {
  "S-SUCCESS-R2A": "success",
  "S-SUCCESS-R2B": "success",
  "S-CATEGORY-ONE-SELECTED": "success",
  "S-SUBJECT-EMPTY-PUBLISHED": "success",
  "S-SENDER-ADDRESS-ONLY": "success",
  "S-SIGNED-OUT": "R7c",
  "S-NO-INBOX-VIEW": "R7c",
  "S-MAILBOX-AMBIGUOUS-WINDOWS": "R7c",
  "S-CATEGORY-NONE-SELECTED": "R7c",
  "S-EMPTY-INBOX": "R7d",
  "S-ZERO-ROWS-NO-EMPTY-STATE": "R7e",
  "S-ORDERING-ABSENT": "R7e",
  "S-ORDERING-INADMISSIBLE-POSINSET": "R7e",
  "S-ORDERING-LABEL-NOT-ABSOLUTE": "R7e",
  "S-ORDERING-TIE": "R7e",
  "S-CANDIDATE-AMBIGUOUS": "R7e",
  "S-CANDIDATE-STALE": "R7e",
  "S-FIELD-ASSOCIATION-FAILURE": "R7e",
  "S-SUBJECT-UNREADABLE": "R7e",
  "S-SENDER-ABSENT": "R7e",
  "S-TRAVERSAL-EXHAUSTED": "R7e",
  "S-GMAIL-UNPERMITTED": "R7a",
  "S-GMAIL-NOT-RUNNING": "R7b",
  "S-GMAIL-UNREADABLE": "R7b",
  "S-DAEMON-REFUSAL-BEFORE-READ": "R7f",
  "S-DAEMON-REFUSAL-PARTIAL": "R7f",
  "S-PROVIDER-FAIL-BEFORE-DISPATCH": "R7g",
  "S-PROVIDER-FAIL-AFTER-DISPATCH": "R7g",
  "S-DISMISS-BEFORE-DISPATCH": "not-a-refusal",
  "S-DISMISS-DURING-WORK": "not-a-refusal",
  "S-DISMISS-DURING-SPEECH": "not-a-refusal",
  "S-LATE-RESULT-AFTER-DISMISSAL": "not-a-refusal",
  "S-INACTIVITY-CLOSE": "not-a-refusal",
  "S-DECLINE-FOLLOW-UP": "not-a-refusal",
};

const AUDIT = /^(0|exactly \d+ \(.+\))$/;
const R7_CLASS = /R7[a-g]/g;
const FENCE = /```[\s\S]*?```/g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

const failures = [];
function fail(message) {
  failures.push(message);
}

const path = join(root, DOC);
if (!existsSync(path)) {
  console.error(`contract-check: ${DOC} not found under ${root} - the check would pass vacuously`);
  process.exit(1);
}

// Markdown-aware stripping only. The shared tools/pins/lib.mjs stripComments
// removes everything after "//", which would mangle every https:// link here.
const raw = readFileSync(path, "utf8");
const prose = raw.replace(FENCE, "").replace(HTML_COMMENT, "");
const lines = prose.split("\n");

const headerIndex = lines.findIndex(
  (line) => line.trim().startsWith("|") && line.includes("| id |") && line.includes("replay-representable"),
);
if (headerIndex === -1) {
  console.error(`contract-check: no acceptance-matrix header found in ${DOC} - the check would pass vacuously`);
  process.exit(1);
}

function cells(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

if (prose.includes("\\|")) {
  fail("contract-check: an escaped pipe appears in the document; cell splitting would be ambiguous");
}

const header = cells(lines[headerIndex]);
if (header.length !== COLUMNS.length) {
  fail(`contract-check: matrix header has ${header.length} columns, expected exactly ${COLUMNS.length}`);
}
for (const [i, name] of header.entries()) {
  if (header.indexOf(name) !== i) fail(`contract-check: matrix header repeats the "${name}" column`);
}
const columnOf = {};
for (const name of COLUMNS) {
  const i = header.indexOf(name);
  if (i === -1) fail(`contract-check: matrix is missing the "${name}" column`);
  columnOf[name] = i;
}
if (failures.length > 0) {
  for (const f of failures) console.error(f);
  process.exit(1);
}

const rows = [];
for (let i = headerIndex + 2; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim().startsWith("|")) break;
  const c = cells(line);
  const row = {};
  for (const name of COLUMNS) row[name] = c[columnOf[name]] ?? "";
  row._width = c.length;
  rows.push(row);
}

if (rows.length === 0) {
  console.error(`contract-check: acceptance matrix has no rows - the check would pass vacuously`);
  process.exit(1);
}

const seen = new Set();
for (const row of rows) {
  const id = row.id;
  if (seen.has(id)) fail(`contract-check: duplicate row id ${id}`);
  seen.add(id);
  if (!REQUIRED_IDS.includes(id)) fail(`contract-check: unknown row id ${id}`);

  for (const name of COLUMNS) {
    if (row[name] === "") fail(`contract-check: ${id} has an empty "${name}" cell`);
  }
  if (!AUDIT.test(row["answer audit"])) {
    fail(`contract-check: ${id} answer audit "${row["answer audit"]}" is not 0 or "exactly <integer> (<roles>)"`);
  }
  if (!DISPOSITIONS.has(row["background-request disposition"])) {
    fail(
      `contract-check: ${id} background-request disposition "${row["background-request disposition"]}" is not one of the four frozen values`,
    );
  }
  if (row._width !== COLUMNS.length) {
    fail(`contract-check: ${id} has ${row._width} cells, expected exactly ${COLUMNS.length}`);
  }

  const expected = OUTCOME_CLASS[id];
  const cited = [...new Set(row["spoken outcome"].match(R7_CLASS) ?? [])];
  if (expected && expected.startsWith("R7")) {
    if (!cited.includes(expected)) {
      fail(`contract-check: ${id} spoken outcome must cite its frozen refusal class ${expected}`);
    }
    if (cited.some((c) => c !== expected)) {
      fail(`contract-check: ${id} spoken outcome cites ${cited.join(", ")} but its frozen class is ${expected}`);
    }
  } else if (expected && cited.length > 0) {
    fail(`contract-check: ${id} is not a refusal row but its spoken outcome cites ${cited.join(", ")}`);
  }
}

for (const id of REQUIRED_IDS) {
  if (!seen.has(id)) fail(`contract-check: missing required row id ${id}`);
}

if (rows.length !== REQUIRED_IDS.length) {
  fail(`contract-check: expected exactly ${REQUIRED_IDS.length} matrix rows, found ${rows.length}`);
}

const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
for (const [id, count] of [
  ["S-SUCCESS-R2A", 3],
  ["S-SUCCESS-R2B", 4],
]) {
  const cell = byId[id]?.["answer audit"] ?? "";
  if (!cell.startsWith(`exactly ${count} (`)) {
    fail(`contract-check: ${id} answer audit must be "exactly ${count} (<roles>)" per R6, found "${cell}"`);
  }
}

for (const id of REQUIRED_IDS) {
  if (!OUTCOME_CLASS[id]) fail(`contract-check: ${id} has no frozen outcome class in this checker`);
}

for (let n = 1; n <= 12; n++) {
  if (!new RegExp(`\\bR${n}[a-g]?\\b`).test(prose)) fail(`contract-check: rule identifier R${n} is absent from the document`);
}

// Secondary prose layer - weaker than the structural checks above, and not the
// primary evidence. These sentences carry decisions that have no table cell.
const PROSE_REQUIRED = [
  ["ADR-0053 authority", "ADR-0053"],
  ["DOM-order prohibition", "DOM/tree traversal order"],
  ["late-result prohibition", "no result from a dismissed request is ever spoken"],
  ["closed ordering allowlist", "The allowlist is closed"],
];
for (const [label, needle] of PROSE_REQUIRED) {
  if (!prose.includes(needle)) fail(`contract-check: ${label} sentence is missing (expected "${needle}")`);
}

if (failures.length > 0) {
  for (const f of failures) console.error(f);
  process.exit(1);
}

const emitted = rows.map(({ _width, ...row }) => row);
console.log(JSON.stringify({ doc: DOC, rows: emitted }, null, 2));
console.error(`contract-check: ok - ${rows.length} rows, ${COLUMNS.length} columns, R1-R12 present`);

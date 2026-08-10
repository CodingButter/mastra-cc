import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// CI step 2 (B6, ADR-0002): the schema freeze is a CI job, not prose. The
// prototype's schema changed 23 times after its freeze was declared, because
// prose does not fail a build. This script diffs protocol/schema.json against
// the merge base and, when it changed, demands the full compliant-change
// ritual: a version bump, an accepted ADR naming the new version, and golden
// fixtures regenerated to match. Each missing piece is reported separately.
//
// Usage: node tools/freeze-gate.mjs [--root <dir>] [--base <ref>]

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const root = arg("--root") ?? fileURLToPath(new URL("..", import.meta.url));

function git(args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

let baseRef = arg("--base");
if (!baseRef) {
  for (const ref of ["master", "origin/master"]) {
    try {
      baseRef = git(["merge-base", "HEAD", ref]);
      break;
    } catch {
      // ref may not exist in this clone; try the next
    }
  }
}
if (!baseRef) {
  console.error("freeze-gate: no merge base found (neither master nor origin/master resolves) - refusing to guess");
  process.exit(1);
}

let baseText = null;
try {
  baseText = execFileSync("git", ["-C", root, "show", `${baseRef}:protocol/schema.json`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
} catch {
  console.log("freeze-gate: no schema at the merge base - this change introduces it, through the same gate");
}

const schemaPath = join(root, "protocol", "schema.json");
const currentText = readFileSync(schemaPath, "utf8");

if (baseText !== null && baseText === currentText) {
  console.log("freeze-gate: schema unchanged");
  process.exit(0);
}

const problems = [];
const currentVersion = JSON.parse(currentText).version;

if (baseText !== null && JSON.parse(baseText).version === currentVersion) {
  problems.push(`the schema changed but the version did not (still ${currentVersion})`);
}

const adrDir = join(root, "docs", "02-DECISIONS");
const adrNamesVersion = readdirSync(adrDir)
  .filter((f) => f.endsWith(".md"))
  .some((f) => readFileSync(join(adrDir, f), "utf8").includes(`schema version ${currentVersion}`));
if (!adrNamesVersion) {
  problems.push(`no ADR names schema version ${currentVersion}`);
}

const freshDir = mkdtempSync(join(tmpdir(), "freeze-gate-"));
execFileSync(process.execPath, [join(root, "protocol", "generate.mjs"), "--schema", schemaPath, "--out", freshDir]);
const goldenDir = join(root, "protocol", "golden");
let goldenStale = false;
for (const rel of walk(freshDir, "")) {
  let goldenText = null;
  try {
    goldenText = readFileSync(join(goldenDir, rel), "utf8");
  } catch {
    // missing golden counts as stale
  }
  if (goldenText !== readFileSync(join(freshDir, rel), "utf8")) goldenStale = true;
}
if (goldenStale) {
  problems.push("golden fixtures were not updated for this schema change");
}

function walk(dir, prefix) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

if (problems.length > 0) {
  for (const p of problems) console.error(`freeze-gate: ${p}`);
  console.error(`freeze-gate: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`freeze-gate: schema changed compliantly - version ${currentVersion}, ADR present, golden fixtures current`);

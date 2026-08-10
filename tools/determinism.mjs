import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// CI step 1 (B7, ADR-0009): regenerate and diff. The generator runs into a
// TEMPORARY directory and its output is compared against the committed golden
// fixtures AND, when present, the generated package on disk. The temp-dir
// shape is the point: regenerating in place silently CORRECTS a hand-edited
// generated file and scores it a pass - exactly the tampering
// docs/07-ROADMAP.md:78 requires this check to catch.
//
// Usage: node tools/determinism.mjs [--root <dir>]

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const root = arg("--root") ?? fileURLToPath(new URL("..", import.meta.url));
const schemaPath = join(root, "protocol", "schema.json");
const goldenDir = join(root, "protocol", "golden");
const generatedDir = join(root, "packages", "protocol-types");

const freshDir = mkdtempSync(join(tmpdir(), "determinism-"));
execFileSync(process.execPath, [join(root, "protocol", "generate.mjs"), "--schema", schemaPath, "--out", freshDir]);

function walk(dir, prefix) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

const emitted = walk(freshDir, "");
if (emitted.length === 0) {
  console.error("determinism: the generator produced no files - the check would pass vacuously");
  process.exit(1);
}

let problems = 0;

function compare(rel, actualPath, label) {
  const fresh = readFileSync(join(freshDir, rel), "utf8");
  let actual = null;
  try {
    actual = readFileSync(actualPath, "utf8");
  } catch {
    console.error(`determinism: ${label}/${rel} is missing`);
    problems += 1;
    return;
  }
  if (actual === fresh) return;
  problems += 1;
  console.error(`determinism: ${label}/${rel} differs from freshly generated output`);
  const actualLines = actual.split("\n");
  const freshLines = fresh.split("\n");
  for (let i = 0; i < Math.max(actualLines.length, freshLines.length); i += 1) {
    if (actualLines[i] !== freshLines[i]) {
      console.error(`  line ${i + 1}:`);
      console.error(`  - ${actualLines[i] ?? "<absent>"}`);
      console.error(`  + ${freshLines[i] ?? "<absent>"}`);
      break;
    }
  }
}

for (const rel of emitted) {
  compare(rel, join(goldenDir, rel), "protocol/golden");
  if (existsSync(generatedDir)) {
    compare(rel, join(generatedDir, rel), "packages/protocol-types");
  }
}

// a golden file the generator no longer emits is stale too
for (const rel of existsSync(goldenDir) ? walk(goldenDir, "") : []) {
  if (!emitted.includes(rel)) {
    console.error(`determinism: protocol/golden/${rel} is not emitted by the generator - a stale fixture`);
    problems += 1;
  }
}

console.log(`determinism: ${emitted.length} generated file(s) compared, ${problems} problem(s)`);
process.exit(problems > 0 ? 1 : 0);

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

// The freeze gate's four cases (docs/02-DECISIONS/0002-schema-freeze-is-a-ci-job.md),
// run against a scratch git repository so no case touches the real tree.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const gate = join(repoRoot, "tools", "freeze-gate.mjs");

let root;
let originalSchema;

function git(...args) {
  execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
}

function runGate() {
  return spawnSync(process.execPath, [gate, "--root", root], { encoding: "utf8" });
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "freeze-test-"));
  mkdirSync(join(root, "protocol"), { recursive: true });
  cpSync(join(repoRoot, "protocol", "schema.json"), join(root, "protocol", "schema.json"));
  cpSync(join(repoRoot, "protocol", "generate.mjs"), join(root, "protocol", "generate.mjs"));
  cpSync(join(repoRoot, "protocol", "golden"), join(root, "protocol", "golden"), { recursive: true });
  mkdirSync(join(root, "docs", "02-DECISIONS"), { recursive: true });
  writeFileSync(
    join(root, "docs", "02-DECISIONS", "0001-scratch.md"),
    "# 0001 - scratch ADR\n\nThis record names schema version 1.0.0.\n",
  );
  git("init", "-b", "master");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "freeze-gate test");
  git("add", "-A");
  git("commit", "-m", "base");
  git("checkout", "-b", "feature");
  originalSchema = readFileSync(join(root, "protocol", "schema.json"), "utf8");
});

describe("the freeze gate", () => {
  it("exits 0 when the schema is unchanged", () => {
    const r = runGate();
    expect(r.stdout).toContain("schema unchanged");
    expect(r.status).toBe(0);
  });

  it("goes red on a version bump with no ADR and stale fixtures, reporting both", () => {
    writeFileSync(
      join(root, "protocol", "schema.json"),
      originalSchema.replace('"version": "1.0.0"', '"version": "1.0.1"'),
    );
    const r = runGate();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no ADR names schema version 1.0.1");
    expect(r.stderr).toContain("golden fixtures were not updated");
  });

  it("goes green again when the edit is reverted", () => {
    writeFileSync(join(root, "protocol", "schema.json"), originalSchema);
    const r = runGate();
    expect(r.status).toBe(0);
  });

  it("accepts a compliant change: version bump, ADR naming it, regenerated fixtures", () => {
    writeFileSync(
      join(root, "protocol", "schema.json"),
      originalSchema.replace('"version": "1.0.0"', '"version": "1.1.0"'),
    );
    writeFileSync(
      join(root, "docs", "02-DECISIONS", "0002-scratch.md"),
      "# 0002 - scratch ADR\n\nThis record names schema version 1.1.0.\n",
    );
    execFileSync(process.execPath, [
      join(root, "protocol", "generate.mjs"),
      "--schema",
      join(root, "protocol", "schema.json"),
      "--out",
      join(root, "protocol", "golden"),
    ]);
    const r = runGate();
    expect(r.stdout).toContain("schema changed compliantly - version 1.1.0");
    expect(r.status).toBe(0);
  });

  it("goes red when the schema changes without a version bump", () => {
    writeFileSync(
      join(root, "protocol", "schema.json"),
      originalSchema.replace('"title": "Mastra CC protocol"', '"title": "Mastra CC protocol "'),
    );
    const r = runGate();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("the schema changed but the version did not (still 1.0.0)");
  });
});

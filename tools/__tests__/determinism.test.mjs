import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

// The determinism check's four cases, against a scratch copy. The check
// generates into a TEMP directory (never in place): regenerating in place
// silently corrects a hand-edited generated file - the exact tampering
// docs/07-ROADMAP.md:78 requires this check to go red on.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const check = join(repoRoot, "tools", "determinism.mjs");

let root;
let generatedIndex;
let goldenIndex;
let originalGenerated;
let originalGolden;

function runCheck() {
  return spawnSync(process.execPath, [check, "--root", root], { encoding: "utf8" });
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "determinism-test-"));
  mkdirSync(join(root, "protocol"), { recursive: true });
  cpSync(join(repoRoot, "protocol", "schema.json"), join(root, "protocol", "schema.json"));
  cpSync(join(repoRoot, "protocol", "generate.mjs"), join(root, "protocol", "generate.mjs"));
  cpSync(join(repoRoot, "protocol", "golden"), join(root, "protocol", "golden"), { recursive: true });
  execFileSync(process.execPath, [
    join(root, "protocol", "generate.mjs"),
    "--schema",
    join(root, "protocol", "schema.json"),
    "--out",
    join(root, "packages", "protocol-types"),
  ]);
  generatedIndex = join(root, "packages", "protocol-types", "src", "index.ts");
  goldenIndex = join(root, "protocol", "golden", "src", "index.ts");
  originalGenerated = readFileSync(generatedIndex, "utf8");
  originalGolden = readFileSync(goldenIndex, "utf8");
});

describe("the determinism check", () => {
  it("exits 0 on a clean tree, comparing a non-empty file set", () => {
    const r = runCheck();
    expect(r.stdout).toContain("2 generated file(s) compared, 0 problem(s)");
    expect(r.status).toBe(0);
  });

  it("goes red on a hand-edited GENERATED file, naming it", () => {
    writeFileSync(generatedIndex, `${originalGenerated}// tampered by hand\n`);
    const r = runCheck();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("packages/protocol-types");
    expect(r.stderr).toContain("differs from freshly generated output");
    writeFileSync(generatedIndex, originalGenerated);
  });

  it("goes red on a hand-edited golden fixture, showing the differing line", () => {
    writeFileSync(goldenIndex, originalGolden.replace("PROTOCOL_VERSION", "PROTOCOL_VERSION_TAMPERED"));
    const r = runCheck();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("protocol/golden");
    expect(r.stderr).toContain("line ");
    expect(r.stderr).toContain("PROTOCOL_VERSION_TAMPERED");
    writeFileSync(goldenIndex, originalGolden);
  });

  it("exits 0 again once both are restored", () => {
    const r = runCheck();
    expect(r.status).toBe(0);
  });
});

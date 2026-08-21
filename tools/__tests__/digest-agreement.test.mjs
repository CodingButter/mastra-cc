import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

// The digest agreement check, run against a scratch tree so no case touches the
// real one. It had none of these until M3's whole-feature review pointed out
// that the fix to its failure message - the message that could not show what it
// found, because it truncated both digests to twelve characters - could be
// undone by anyone with nothing going red.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const check = join(repoRoot, "tools", "digest-agreement.mjs");

let root;
let goldenPath;

function run() {
  return spawnSync(process.execPath, [check, "--root", root], { encoding: "utf8" });
}

/** The digest the scratch tree's artifacts declare, whatever the real schema currently hashes to. */
function declaredDigest() {
  return readFileSync(goldenPath, "utf8").match(/SCHEMA_DIGEST = "([0-9a-f]{64})"/)[1];
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "digest-agreement-test-"));
  mkdirSync(join(root, "protocol"), { recursive: true });
  cpSync(join(repoRoot, "protocol", "schema.json"), join(root, "protocol", "schema.json"));
  cpSync(join(repoRoot, "protocol", "golden"), join(root, "protocol", "golden"), { recursive: true });
  goldenPath = join(root, "protocol", "golden", "src", "index.ts");
});

describe("the digest agreement check", () => {
  it("agrees when the artifact was cut from the schema on disk", () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("artifact(s) agree");
  });

  it("shows both digests in full when they differ by one character", () => {
    // THE CASE THE MESSAGE EXISTS FOR. A one-digit difference is the hardest
    // mismatch to read and the easiest to cause, and a message that truncates
    // to a shared prefix reports it as two identical strings.
    const declared = declaredDigest();
    const altered = declared.slice(0, -1) + (declared.endsWith("a") ? "b" : "a");
    writeFileSync(goldenPath, readFileSync(goldenPath, "utf8").replace(declared, altered));

    const r = run();
    expect(r.status).toBe(1);
    // Both digests, whole. Not a prefix of either.
    expect(r.stderr).toContain(altered);
    expect(r.stderr).toContain(declared);
    // And the two are distinguishable in the output a person actually reads,
    // which is the entire point: a truncating message fails this line.
    expect(altered).not.toBe(declared);
    expect(r.stderr.includes(`${altered} but the schema on disk is ${declared}`)).toBe(true);
  });

  it("refuses an artifact that declares no digest at all", () => {
    writeFileSync(goldenPath, readFileSync(goldenPath, "utf8").replace(/SCHEMA_DIGEST = "[0-9a-f]{64}"/, 'SCHEMA_DIGEST_REMOVED = ""'));
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("declares no schema digest");
  });

  it("refuses a missing artifact rather than passing over its absence", () => {
    // Vacuity: a check that reads no artifacts must not report agreement.
    rmSync(goldenPath);
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("is missing");
    expect(r.stdout).not.toContain("agree");
  });
});

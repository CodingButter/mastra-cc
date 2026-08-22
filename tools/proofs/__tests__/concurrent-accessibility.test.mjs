import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { renderArtifact } from "../concurrent-accessibility.mjs";

// The proof script's own guarantees (docs/05-TEST-STRATEGY.md:160-163): a
// partial result writes nothing, and the offline lane gets a distinct refusal
// that never touches a bus.

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "concurrent-accessibility.mjs");

const ENV = { date: "2026-08-09", cpu: "test", mem: 1, kernel: "test", node: "test", binding: "test@0" };

function fullMatrix() {
  const results = [];
  for (const mode of ["sequential", "concurrent-setup", "concurrent-use"]) {
    for (const n of [2, 4, 8]) {
      for (let rep = 1; rep <= 3; rep += 1) {
        results.push({ mode, n, rep, exit: 0, signal: null, wallMs: 5, workerMs: 4, apps: [20], binding: "test@0" });
      }
    }
  }
  return results;
}

describe("the proof writes nothing on a partial result", () => {
  it("renders a complete matrix", () => {
    const artifact = renderArtifact(fullMatrix(), ENV);
    expect(artifact).toContain("Neither was observed");
    expect(artifact).toContain("keeps serialising accessibility access");
  });

  it("refuses when a run is missing", () => {
    expect(() => renderArtifact(fullMatrix().slice(0, -1), ENV)).toThrow(/partial result.*writing nothing/);
  });

  it("refuses when a duration is absent", () => {
    const results = fullMatrix();
    results[5].wallMs = null;
    expect(() => renderArtifact(results, ENV)).toThrow(/no duration - writing nothing/);
  });

  it("attributes a concurrent-setup failure to setup, not use", () => {
    const results = fullMatrix();
    const failing = results.find((r) => r.mode === "concurrent-setup" && r.n === 2 && r.rep === 1);
    failing.exit = null;
    failing.signal = "SIGTRAP";
    const artifact = renderArtifact(results, ENV);
    expect(artifact).toContain("**concurrent setup failed**");
    expect(artifact).not.toContain("**concurrent use failed**");
  });

  it("makes no concurrency claim when the control fails", () => {
    const results = fullMatrix();
    results.find((r) => r.mode === "sequential").exit = 1;
    expect(renderArtifact(results, ENV)).toContain("The control failed");
  });
});

describe("--no-live", () => {
  const dir = mkdtempSync(join(tmpdir(), "concurrency-proof-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("exits 2 with a refusal and writes nothing", () => {
    const out = join(dir, "artifact.md");
    const child = spawnSync(process.execPath, [SCRIPT, "--no-live", "--out", out], { encoding: "utf8" });
    expect(child.status).toBe(2);
    expect(child.stderr).toContain("refusing without touching it");
    expect(existsSync(out)).toBe(false);
  });
});

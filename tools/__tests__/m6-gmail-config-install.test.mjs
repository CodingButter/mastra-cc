import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const apply = join(repoRoot, "infra", "apply.sh");
const scratches = [];

function scratch() {
  const root = mkdtempSync(join(tmpdir(), "m6-gmail-install-"));
  scratches.push(root);
  return root;
}

function runApply(prefix, args = []) {
  return spawnSync("bash", [apply, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, MASTRA_CC_PREFIX: prefix, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || "/tmp" },
  });
}

function mode(path) {
  return statSync(path).mode & 0o777;
}

function relativeImports(entry) {
  const source = readFileSync(entry, "utf8");
  return [...source.matchAll(/(?:from\s*|import\s*)["'](\.\.?\/[^"']+)["']/g)].map((match) =>
    fileURLToPath(new URL(match[1], pathToFileURL(entry))),
  );
}

afterEach(() => {
  while (scratches.length > 0) rmSync(scratches.pop(), { recursive: true, force: true });
});

describe("M6 Gmail operator configuration installation", () => {
  it("seeds the restrictive authority files and complete daemon tree on a fresh prefix", () => {
    const prefix = scratch();
    const result = runApply(prefix);
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);

    const configDir = join(prefix, ".config", "mastra-cc");
    const grants = join(configDir, "gmail-grants.json");
    const capabilities = join(configDir, "gmail-capabilities.json");
    const stateDir = join(prefix, ".local", "state", "mastra-cc");
    const daemonDir = join(prefix, ".local", "lib", "mastra-cc", "daemon");
    const entry = join(daemonDir, "main.mjs");

    expect(JSON.parse(readFileSync(grants, "utf8"))).toEqual({ applications: ["gmail"] });
    expect(JSON.parse(readFileSync(capabilities, "utf8"))).toEqual({
      defaults: { launch: false },
      applications: { gmail: { launch: true } },
    });
    expect(mode(configDir)).toBe(0o700);
    expect(mode(grants)).toBe(0o600);
    expect(mode(capabilities)).toBe(0o600);
    expect(mode(stateDir)).toBe(0o700);
    expect(existsSync(join(stateDir, "audit.jsonl"))).toBe(false);

    expect(existsSync(entry)).toBe(true);
    for (const artifact of readdirSync(join(repoRoot, "daemon", "dist"))) {
      expect(existsSync(join(daemonDir, artifact)), artifact).toBe(true);
    }
    expect(existsSync(join(daemonDir, "tools", "pins", "deny-list.json"))).toBe(true);
    for (const imported of relativeImports(entry)) expect(existsSync(imported), imported).toBe(true);

    const boot = spawnSync(process.execPath, [entry], { encoding: "utf8" });
    expect(boot.status).toBe(2);
    expect(`${boot.stdout}${boot.stderr}`).toContain("--backend is required");
    expect(`${boot.stdout}${boot.stderr}`).not.toContain("ERR_MODULE_NOT_FOUND");
  });

  it("preserves operator edits while replacing repository-owned daemon output", () => {
    const prefix = scratch();
    const first = runApply(prefix);
    expect(first.status, `${first.stdout}${first.stderr}`).toBe(0);

    const grants = join(prefix, ".config", "mastra-cc", "gmail-grants.json");
    const capabilities = join(prefix, ".config", "mastra-cc", "gmail-capabilities.json");
    const daemonDir = join(prefix, ".local", "lib", "mastra-cc", "daemon");
    const editedGrants = "{\n  \"applications\": []\n}\n";
    const editedCapabilities = "{\n  \"defaults\": { \"launch\": false }\n}\n";
    writeFileSync(grants, editedGrants);
    writeFileSync(capabilities, editedCapabilities);
    chmodSync(grants, 0o600);
    chmodSync(capabilities, 0o600);
    writeFileSync(join(daemonDir, "main.mjs"), "broken repository artifact\n");
    writeFileSync(join(daemonDir, "stale-content-hash.mjs"), "stale\n");

    const second = runApply(prefix);
    expect(second.status, `${second.stdout}${second.stderr}`).toBe(0);
    expect(readFileSync(grants, "utf8")).toBe(editedGrants);
    expect(readFileSync(capabilities, "utf8")).toBe(editedCapabilities);
    expect(readFileSync(join(daemonDir, "main.mjs"), "utf8")).toBe(
      readFileSync(join(repoRoot, "daemon", "dist", "main.mjs"), "utf8"),
    );
    expect(existsSync(join(daemonDir, "stale-content-hash.mjs"))).toBe(false);

    const third = runApply(prefix);
    expect(third.status, `${third.stdout}${third.stderr}`).toBe(0);
    expect(third.stdout).toContain("apply: no changes");

    const dry = runApply(prefix, ["--dry-run"]);
    expect(dry.status, `${dry.stdout}${dry.stderr}`).toBe(0);
    expect(dry.stdout).toContain("apply: no changes");
    expect(dry.stdout).not.toContain("change(s) pending");
    expect(readFileSync(grants, "utf8")).toBe(editedGrants);
    expect(readFileSync(capabilities, "utf8")).toBe(editedCapabilities);
  });

  it("reports a dry run without writing or requiring a built daemon tree", () => {
    const root = scratch();
    const isolatedApply = join(root, "repo", "infra", "apply.sh");
    const prefix = join(root, "fresh-prefix");
    mkdirSync(dirname(isolatedApply), { recursive: true });
    writeFileSync(isolatedApply, readFileSync(apply, "utf8"));
    chmodSync(isolatedApply, 0o755);

    const result = spawnSync("bash", [isolatedApply, "--dry-run"], {
      encoding: "utf8",
      env: { ...process.env, MASTRA_CC_PREFIX: prefix, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || "/tmp" },
    });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("would seed");
    expect(result.stdout).toContain("would install tree");
    expect(existsSync(prefix)).toBe(false);
  });
});

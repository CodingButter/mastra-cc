import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCapabilitiesFile, withheldBy } from "../capabilities.js";
import { loadGrantsFile } from "../grants.js";
import { composeBootNames } from "../launch/profiles.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const APPLY = resolve(ROOT, "infra/apply.sh");
const MINT = resolve(ROOT, "apps/hub/src/tools/mint.ts");

function execStartArguments(unit: string): string[] {
  const line = unit.split("\n").find((candidate) => candidate.startsWith("ExecStart="));
  if (line === undefined) throw new Error("unit has no ExecStart");
  return line.slice("ExecStart=".length).trim().split(/\s+/u);
}

function option(arguments_: readonly string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);
  return index === -1 ? undefined : arguments_[index + 1];
}

function resolveHome(path: string | undefined, home: string): string | undefined {
  return path?.replaceAll("%h", home);
}

describe("M6 Gmail startup composition", () => {
  let prefix: string;
  let arguments_: string[];

  beforeAll(() => {
    prefix = mkdtempSync(resolve(tmpdir(), "mastra-cc-m6-composition-"));
    execFileSync("bash", [APPLY], {
      cwd: ROOT,
      env: { ...process.env, MASTRA_CC_PREFIX: prefix, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? "/tmp" },
    });
    const unit = readFileSync(resolve(prefix, ".config/systemd/user/mastra-desktop-daemon.service"), "utf8");
    arguments_ = execStartArguments(unit);
  });

  afterAll(() => rmSync(prefix, { recursive: true, force: true }));

  it("joins the installed unit and operator files into the exact authority tuple", () => {
    expect(arguments_.slice(0, 3)).toEqual([
      "/usr/bin/env",
      "node",
      "%h/.local/lib/mastra-cc/daemon/main.mjs",
    ]);
    expect(resolveHome(arguments_[2], prefix)).toBe(resolve(prefix, ".local/lib/mastra-cc/daemon/main.mjs"));
    expect(option(arguments_, "--backend")).toBe("cdp");
    expect(arguments_.filter((argument) => argument === "--permit")).toHaveLength(1);
    expect(option(arguments_, "--permit")).toBe("gmail");
    expect(arguments_).not.toContain("--grant");
    expect(arguments_).not.toContain("--profiles");
    expect(arguments_).not.toContain("--allow");
    expect(arguments_).not.toContain("all");

    const grantsPath = resolveHome(option(arguments_, "--grants"), prefix);
    const capabilitiesPath = resolveHome(option(arguments_, "--capabilities"), prefix);
    const auditPath = resolveHome(option(arguments_, "--audit"), prefix);
    expect(grantsPath).toBe(resolve(prefix, ".config/mastra-cc/gmail-grants.json"));
    expect(capabilitiesPath).toBe(resolve(prefix, ".config/mastra-cc/gmail-capabilities.json"));
    expect(auditPath).toBe(resolve(prefix, ".local/state/mastra-cc/audit.jsonl"));

    const grants = loadGrantsFile(grantsPath!);
    expect([...grants]).toEqual(["gmail"]);
    const names = composeBootNames({ permits: new Set([option(arguments_, "--permit")!]), grants, flags: new Set(), catalog: DEFANGED_CATALOG });
    expect([...names.launchPermits]).toEqual(["gmail"]);
    expect([...names.visibility].sort()).toEqual(["chrome", "gmail"]);

    const capabilities = loadCapabilitiesFile(capabilitiesPath!);
    expect(withheldBy(capabilities, "launch", "gmail")).toBeUndefined();
    expect(withheldBy(capabilities, "launch", "chrome")).toBe("defaults.launch");
    expect(withheldBy(capabilities, "launch", "yad")).toBe("defaults.launch");
  });

  it("keeps identity substitution from satisfying the Gmail contract", () => {
    const names = composeBootNames({ permits: new Set(["chrome"]), grants: new Set(["gmail"]), flags: new Set(), catalog: DEFANGED_CATALOG });
    expect([...names.launchPermits]).not.toEqual(["gmail"]);
  });

  it("keeps the model mint at the three-tool observe floor with no launch tool", () => {
    const source = readFileSync(MINT, "utf8");
    expect(source).toMatch(/const OBSERVE_TOOLS[^=]*= \["queryElements", "attestElement", "listApplications"\];/u);
    expect(source).not.toMatch(/["']openApplication["']/u);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCapabilitiesFile, withheldBy } from "../capabilities.js";
import { loadGrantsFile } from "../grants.js";
import { composeBootNames } from "../launch/profiles.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const UNIT = resolve(ROOT, "infra/units/mastra-desktop-daemon.service");
const GRANTS = resolve(ROOT, "infra/config/gmail-grants.json");
const CAPABILITIES = resolve(ROOT, "infra/config/gmail-capabilities.json");

function execStartArguments(unit: string): string[] {
  const line = unit.split("\n").find((candidate) => candidate.startsWith("ExecStart="));
  if (line === undefined) throw new Error("unit has no ExecStart");
  return line.slice("ExecStart=".length).trim().split(/\s+/u);
}

function option(arguments_: readonly string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);
  return index === -1 ? undefined : arguments_[index + 1];
}

function authorityTuple(arguments_: readonly string[]) {
  const grants = loadGrantsFile(GRANTS);
  const names = composeBootNames({
    permits: new Set([option(arguments_, "--permit")!]),
    grants,
    flags: new Set(),
    catalog: DEFANGED_CATALOG,
  });
  return {
    launchPermits: [...names.launchPermits],
    visibility: [...names.visibility].sort(),
  };
}

const arguments_ = execStartArguments(readFileSync(UNIT, "utf8"));

describe("M6 Gmail startup composition", () => {
  it("joins the checked-in unit and operator seeds into the exact authority tuple", () => {
    expect(arguments_.slice(0, 3)).toEqual([
      "/usr/bin/env",
      "node",
      "%h/.local/lib/mastra-cc/daemon/main.mjs",
    ]);
    expect(option(arguments_, "--backend")).toBe("cdp");
    expect(arguments_.filter((argument) => argument === "--permit")).toHaveLength(1);
    expect(option(arguments_, "--permit")).toBe("gmail");
    expect(arguments_).not.toContain("--grant");
    expect(arguments_).not.toContain("--profiles");
    expect(arguments_).not.toContain("--allow");
    expect(arguments_).not.toContain("all");

    expect(option(arguments_, "--grants")).toBe("%h/.config/mastra-cc/gmail-grants.json");
    expect(option(arguments_, "--capabilities")).toBe("%h/.config/mastra-cc/gmail-capabilities.json");
    expect(option(arguments_, "--audit")).toBe("%h/.local/state/mastra-cc/audit.jsonl");

    expect([...loadGrantsFile(GRANTS)]).toEqual(["gmail"]);
    expect(authorityTuple(arguments_)).toEqual({
      launchPermits: ["gmail"],
      visibility: ["chrome", "gmail"],
    });

    const capabilities = loadCapabilitiesFile(CAPABILITIES);
    expect(withheldBy(capabilities, "launch", "gmail")).toBeUndefined();
    expect(withheldBy(capabilities, "launch", "chrome")).toBe("defaults.launch");
    expect(withheldBy(capabilities, "launch", "yad")).toBe("defaults.launch");
  });

  it("makes substituting another built-in identity violate the authority tuple", () => {
    const substituted = [...arguments_];
    substituted[substituted.indexOf("gmail")] = "chrome";
    expect(authorityTuple(substituted)).not.toEqual({
      launchPermits: ["gmail"],
      visibility: ["chrome", "gmail"],
    });
  });

  // A third case asserted the hub's model mint stayed at the three-tool observe
  // floor. The hub is gone (ADR-0057) and the assertion went with it: the floor
  // it guarded was a property of a caller this repository no longer ships. What
  // remains here is the daemon's own half — the operator unit and the authority
  // tuple it composes — which is what ADR-0054 froze and what still ships.
});

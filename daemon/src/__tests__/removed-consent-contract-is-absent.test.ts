import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureDaemonBuilt } from "./support/ensure-daemon-built.js";

const root = join(import.meta.dirname, "..", "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const removedFlags = ["--grants", "--grant", "--permit", "--allow", "--capabilities", "--acquire-accessibility"];

beforeAll(() => ensureDaemonBuilt(root));

describe("the agent-owned daemon has no consent-era contract", () => {
  it("deletes consent modules, exports, and launch-context fields", () => {
    expect(existsSync(join(root, "daemon/src/grants.ts"))).toBe(false);
    expect(existsSync(join(root, "daemon/src/capabilities.ts"))).toBe(false);

    const production = [
      read("daemon/src/server/grants.ts"),
      read("daemon/src/server/dispatch.ts"),
      read("daemon/src/server/launch-focus.ts"),
      read("daemon/src/main.ts"),
      read("daemon/src/backends/atspi/index.ts"),
      read("daemon/src/backends/cdp/index.ts"),
      read("daemon/src/backends/replay/index.ts"),
      read("daemon/src/backends/registry.ts"),
    ].join("\n");

    for (const removed of [
      "EffectClassGate",
      "DisabledByConfiguration",
      "disabled-by-configuration",
      "mayAcquireAccessibility",
      "ApplicationIdentityMismatch",
      "NO_PERMITS",
      "restartAuthority",
      "permits?:",
      "allows?:",
      "capabilities?:",
      "visibility?:",
      "../grants.js",
      "../capabilities.js",
    ]) {
      expect(production).not.toContain(removed);
    }
  });

  it.each(removedFlags)("rejects removed flag %s at runtime", (flag) => {
    const result = spawnSync(process.execPath, [join(root, "daemon/dist/main.mjs"), "--backend", "replay", flag, "fixture"], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${flag} was removed in protocol 1.30.0`);
  });

  it("removes consent-era wording from the protocol schema", () => {
    const schema = read("protocol/schema.json").toLowerCase();
    for (const wording of [
      "effect-class gate",
      "not granted",
      "existing grants",
      "authorised",
      "permitted application",
      "turned off",
      "named setting",
      "setting would",
      "setting could",
      "permitted",
      "may do it",
    ]) {
      expect(schema).not.toContain(wording);
    }
  });

  it("keeps route-derived not-exposed as a truthful availability state", () => {
    expect(JSON.parse(read("protocol/schema.json")).availabilityStates).toContain("not-exposed");
  });
});

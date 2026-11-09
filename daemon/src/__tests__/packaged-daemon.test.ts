import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { POLL_BUDGET_MS } from "../server/launch-focus.js";
import { serverSource } from "./server-source.js";
import { ensureDaemonBuilt } from "./support/ensure-daemon-built.js";

const root = join(import.meta.dirname, "..", "..", "..");

beforeAll(() => ensureDaemonBuilt(root));

describe("the packaged daemon remains location-transparent", () => {
  it("ships the action vocabulary data beside the built bundle", () => {
    const packageJson = JSON.parse(readFileSync(join(root, "daemon", "package.json"), "utf8"));
    expect(packageJson.scripts.build).toContain("dist/tools/pins/deny-list.json");
  });

  it("uses the same explicit default socket shape as the transport", () => {
    const daemon = readFileSync(join(root, "daemon", "src", "main.ts"), "utf8");
    const transport = readFileSync(join(root, "packages", "transport", "src", "index.ts"), "utf8");
    expect(daemon).toContain('join(process.env.XDG_RUNTIME_DIR ?? "/tmp", "mastra-cc", "daemon.sock")');
    expect(transport).toContain('const runtimeDir = process.env.XDG_RUNTIME_DIR ?? "/tmp"');
    expect(transport).toContain('join(runtimeDir, "mastra-cc", "daemon.sock")');
  });

  it("leaves no static package import the copied tree cannot resolve", () => {
    const dist = join(root, "daemon", "dist");
    const bundles = readdirSync(dist).filter((name) => name.endsWith(".mjs"));
    expect(bundles.length).toBeGreaterThan(0);
    const specifiers = new Map<string, string>();
    for (const file of bundles) {
      const source = readFileSync(join(dist, file), "utf8");
      for (const match of source.matchAll(/(?:^|[\s;}])(?:from|import\s*\()\s*["']([^"'.][^"']*)["']/gm)) {
        specifiers.set(match[1]!, file);
      }
    }
    expect([...specifiers.keys()].some((specifier) => specifier.startsWith("node:"))).toBe(true);
    expect([...specifiers].filter(([specifier]) => !specifier.startsWith("node:")).map(([specifier, file]) => `${specifier} (${file})`)).toEqual([]);
  });

  it("keeps launch readiness bounded and refuses to pretend spawn means readable", () => {
    expect(POLL_BUDGET_MS).toBe(60_000);
    expect(serverSource()).toContain("was opened but did not become readable within");
  });
});

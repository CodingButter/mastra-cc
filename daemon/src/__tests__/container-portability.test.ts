import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeBootNames } from "../launch/profiles.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";

const root = join(import.meta.dirname, "..", "..", "..");

describe("the built daemon remains location-transparent", () => {
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

  // infra/apply.sh copies dist/ and nothing else, so any bare specifier left in
  // the output is a package the installed daemon cannot resolve. Adding `ws`
  // reached that trap: the flag worked in the repo, where resolution walks up to
  // the workspace node_modules, and died on a copied tree.
  // Scope: static ESM imports only. `require()` forms survive bundling too — probe.ts
  // reads dbus-native's manifest that way, and ws carries optional native accelerators —
  // but those are guarded at their call sites, and matching them would drag in the
  // unprefixed builtins the bundler emits.
  it("leaves no static package import the copied tree cannot resolve", () => {
    const dist = join(root, "daemon", "dist");
    const bundles = readdirSync(dist).filter((name) => name.endsWith(".mjs"));
    // Vacuity guard: an absent or empty dist would make the scan below pass while
    // reading nothing at all.
    expect(bundles.length).toBeGreaterThan(0);
    const specifiers = new Map<string, string>();
    for (const file of bundles) {
      const source = readFileSync(join(dist, file), "utf8");
      for (const match of source.matchAll(/(?:^|[\s;}])(?:from|import\s*\()\s*["']([^"'.][^"']*)["']/gm)) {
        specifiers.set(match[1]!, file);
      }
    }
    // The matcher must actually be finding imports; node: builtins are always there.
    expect([...specifiers.keys()].some((specifier) => specifier.startsWith("node:"))).toBe(true);
    const unresolvable = [...specifiers]
      .filter(([specifier]) => !specifier.startsWith("node:"))
      .map(([specifier, file]) => `${specifier} (${file})`);
    expect(unresolvable).toEqual([]);
  });

  it("keeps launch identity mapping provider-neutral", () => {
    const names = composeBootNames({
      permits: new Set(["gmail"]),
      grants: new Set(),
      flags: new Set(),
      catalog: DEFANGED_CATALOG,
    });
    expect(names.launchPermits).toEqual(new Set(["gmail"]));
    expect(names.visibility).not.toBe("all");
    expect(names.visibility === "all" ? false : names.visibility.has(DEFANGED_CATALOG.gmail.appearsAs!)).toBe(true);
  });

  it("keeps launch readiness bounded and refuses to pretend spawn means readable", () => {
    const server = readFileSync(join(root, "daemon", "src", "server.ts"), "utf8");
    expect(server).toContain("POLL_BUDGET_MS = 10_000");
    expect(server).toContain("was opened but did not become readable within");
  });
});

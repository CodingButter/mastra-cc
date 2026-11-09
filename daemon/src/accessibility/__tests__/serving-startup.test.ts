import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ensureDaemonBuilt } from "../../__tests__/support/ensure-daemon-built.js";
import type { AccessibilityLayer, AccessibilityReport } from "../index.js";
import {
  ACCESSIBILITY_CANNOT_TELL_DIAGNOSTIC,
  ACCESSIBILITY_UNAVAILABLE_DIAGNOSTIC,
  startAfterAccessibility,
} from "../startup.js";

function layer(reports: AccessibilityReport[], acquire: () => Promise<void> = async () => undefined): AccessibilityLayer {
  let read = 0;
  return {
    acquirable: true,
    acquire,
    report: async () => reports[Math.min(read++, reports.length - 1)]!,
  };
}

const fast = { attempts: 3, wait: async () => undefined };
const root = resolve(import.meta.dirname, "../../../..");

beforeAll(() => ensureDaemonBuilt(root));

describe("AT-SPI serving startup", () => {
  it("acquires before starting either listener", async () => {
    const order: string[] = [];
    const accessibility = layer(
      [{ state: "disabled" }, { state: "enabled" }],
      async () => { order.push("acquire"); },
    );
    const result = await startAfterAccessibility({
      backend: "atspi",
      mode: "serve",
      accessibility,
      ...fast,
      start: async () => { order.push("listen"); return "ready"; },
    });
    expect(result).toBe("ready");
    expect(order).toEqual(["acquire", "listen"]);
  });

  it("starts idempotently when the layer is already enabled", async () => {
    const acquire = vi.fn(async () => undefined);
    const start = vi.fn(async () => "ready");
    await startAfterAccessibility({ backend: "atspi", mode: "serve", accessibility: layer([{ state: "enabled" }], acquire), ...fast, start });
    expect(acquire).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledOnce();
  });

  it("exits before listener creation when state remains cannot-tell", async () => {
    const start = vi.fn(async () => "impossible");
    await expect(startAfterAccessibility({
      backend: "atspi", mode: "serve", accessibility: layer([{ state: "cannot-tell", reason: "silent" }]), ...fast, start,
    })).rejects.toThrow(ACCESSIBILITY_CANNOT_TELL_DIAGNOSTIC);
    expect(start).not.toHaveBeenCalled();
  });

  it("exits before listener creation when acquisition is unavailable", async () => {
    const accessibility: AccessibilityLayer = {
      acquirable: false,
      acquire: async () => { throw new Error("must not acquire"); },
      report: async () => ({ state: "disabled" }),
    };
    const start = vi.fn(async () => "impossible");
    await expect(startAfterAccessibility({ backend: "atspi", mode: "serve", accessibility, ...fast, start }))
      .rejects.toThrow(ACCESSIBILITY_UNAVAILABLE_DIAGNOSTIC);
    expect(start).not.toHaveBeenCalled();
  });

  it("bounds failed acquisition retries and never binds", async () => {
    const acquire = vi.fn(async () => { throw new Error("read-only"); });
    const start = vi.fn(async () => "impossible");
    await expect(startAfterAccessibility({
      backend: "atspi", mode: "serve", accessibility: layer([{ state: "disabled" }], acquire), ...fast, start,
    })).rejects.toThrow(ACCESSIBILITY_UNAVAILABLE_DIAGNOSTIC);
    expect(acquire).toHaveBeenCalledTimes(3);
    expect(start).not.toHaveBeenCalled();
  });

  it.each(["replay", "cdp-replay"])("bypasses acquisition for the %s backend", async (backend) => {
    const report = vi.fn(async () => ({ state: "cannot-tell" as const }));
    const start = vi.fn(async () => "ready");
    await expect(startAfterAccessibility({ backend, mode: "serve", accessibility: { acquirable: false, acquire: async () => undefined, report }, ...fast, start }))
      .resolves.toBe("ready");
    expect(report).not.toHaveBeenCalled();
  });

  it.each(["query", "resolve"] as const)("bypasses acquisition for one-shot %s mode", async (mode) => {
    const report = vi.fn(async () => ({ state: "cannot-tell" as const }));
    const start = vi.fn(async () => "ready");
    await expect(startAfterAccessibility({ backend: "atspi", mode, accessibility: { acquirable: false, acquire: async () => undefined, report }, ...fast, start }))
      .resolves.toBe("ready");
    expect(report).not.toHaveBeenCalled();
  });

  it("exits non-zero without leaving a socket when AT-SPI readiness cannot be established", () => {
    const scratch = mkdtempSync(join(tmpdir(), "mastra-cc-a11y-startup-"));
    const socket = join(scratch, "daemon.sock");
    try {
      const result = spawnSync(process.execPath, [
        join(root, "daemon/dist/main.mjs"),
        "--backend", "atspi",
        "--socket", socket,
      ], { encoding: "utf8", timeout: 10_000 });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(new RegExp(`${ACCESSIBILITY_CANNOT_TELL_DIAGNOSTIC}|${ACCESSIBILITY_UNAVAILABLE_DIAGNOSTIC}`));
      expect(existsSync(socket)).toBe(false);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

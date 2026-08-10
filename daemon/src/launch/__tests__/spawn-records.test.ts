import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import type { LaunchCatalog } from "../recipes.js";
import { launchApplication, NO_RECIPE_REFUSAL, terminateOwned } from "../spawn.js";
import { OwnershipTable, readStat } from "../table.js";

// launchApplication with injected test catalogs - real child processes, real
// /proc. The injected catalog is the constructor-parameter seam recipes.ts
// promises: tests register harmless commands, the real catalog is the default.

const launchedPids: number[] = [];
const tempDirs: string[] = [];

function tracked(pid: number): number {
  launchedPids.push(pid);
  return pid;
}

async function waitGone(pid: number): Promise<void> {
  for (let i = 0; i < 100 && readStat(pid) !== undefined; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

afterEach(async () => {
  for (const pid of launchedPids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
    await waitGone(pid);
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("launchApplication", () => {
  it("records the child with its real start time before resolving", async () => {
    const catalog: LaunchCatalog = { "test-sleep": { argv: ["sleep", "30"], env: {} } };
    const table = new OwnershipTable();
    const { pid } = await launchApplication("test-sleep", catalog, table);
    tracked(pid);

    const entry = table.entries().find((e) => e.pid === pid);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe("test-sleep");
    expect(entry?.starttime).toBe(readStat(pid)?.starttime); // the real /proc value
    expect(table.owns(pid)).toBe(true);
  });

  it("merges the recipe's env over the daemon's so it reaches the child", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m21-env-"));
    tempDirs.push(dir);
    const out = join(dir, "marker.txt");
    const catalog: LaunchCatalog = {
      "test-marker": {
        argv: ["sh", "-c", `echo "$MARKER" > "${out}"`],
        env: { MARKER: "m2-1-enabling-env" },
      },
    };
    const table = new OwnershipTable();
    const { pid } = await launchApplication("test-marker", catalog, table);
    tracked(pid);
    await waitGone(pid);
    expect(readFileSync(out, "utf8").trim()).toBe("m2-1-enabling-env");
  });

  it("removes the table entry when the direct child exits", async () => {
    const catalog: LaunchCatalog = { "test-quick": { argv: ["sh", "-c", "exit 0"], env: {} } };
    const table = new OwnershipTable();
    const { pid } = await launchApplication("test-quick", catalog, table);
    tracked(pid);
    for (let i = 0; i < 100 && table.entries().length > 0; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(table.entries()).toHaveLength(0);
    expect(table.owns(pid)).toBe(false);
  });

  it("refuses an unknown catalog name naming nothing about the filesystem", async () => {
    const catalog: LaunchCatalog = { "test-sleep": { argv: ["sleep", "30"], env: {} } };
    const table = new OwnershipTable();
    await expect(launchApplication("not-in-the-catalog", catalog, table)).rejects.toThrow(NO_RECIPE_REFUSAL);
    // the refusal must not leak a path, a command, or installed-ness
    expect(NO_RECIPE_REFUSAL).not.toContain("/");
    expect(NO_RECIPE_REFUSAL).not.toContain("sleep");
    expect(NO_RECIPE_REFUSAL).not.toContain("install");
    expect(table.entries()).toHaveLength(0);
  });
});

describe("terminateOwned", () => {
  it("kills a launched child and leaves an unrecorded process untouched", async () => {
    const catalog: LaunchCatalog = { "test-sleep": { argv: ["sleep", "300"], env: {} } };
    const table = new OwnershipTable();
    const { pid: ownedPid } = await launchApplication("test-sleep", catalog, table);
    tracked(ownedPid);

    // an unrelated process, spawned but never recorded
    const bystander = spawn("sleep", ["300"], { stdio: "ignore" });
    await new Promise<void>((resolve, reject) => {
      bystander.once("spawn", () => resolve());
      bystander.once("error", reject);
    });
    const bystanderPid = tracked(bystander.pid as number);

    terminateOwned(table);
    await waitGone(ownedPid);

    expect(readStat(ownedPid)).toBeUndefined(); // the owned child is gone
    expect(readStat(bystanderPid)).toBeDefined(); // the bystander is not touched
  });
});

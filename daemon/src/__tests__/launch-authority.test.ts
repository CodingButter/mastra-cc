import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { SemanticElement } from "@mastra-cc/protocol-types";
import type { Backend } from "../backend.js";
import { registry } from "../backends/registry.js";
import type { LaunchCatalog } from "../launch/recipes.js";
import { OwnershipTable } from "../launch/table.js";
import {
  ALREADY_RUNNING_REFUSAL,
  COULD_NOT_START_REFUSAL,
  UNAVAILABLE_REFUSAL,
  handleRequest,
  type LaunchContext,
} from "../server.js";

// Authority before capability, and the no-leak property (ADR-0019, ADR-0034).
// The refusal-equality assertions use toBe on the exact strings: byte
// equality IS the security property - an unknown name and an unpermitted name
// must be indistinguishable, or a refusal reveals what is installed.
// Real child processes where a spawn is involved; the replay backend supplies
// a real captured tree (its application is named "yad").

const FAST = { pollBudgetMs: 60, pollIntervalMs: 10 };

function launch(overrides: Partial<LaunchContext>): LaunchContext {
  return { permits: new Set(), catalog: {}, table: new OwnershipTable(), ...FAST, ...overrides };
}

function open(name: string, backend: Backend, context: LaunchContext) {
  return handleRequest({ type: "request", id: 1, method: "openApplication", params: { name } }, backend, context);
}

function resultOf(response: { result?: unknown }) {
  return response.result as { application?: SemanticElement; refusal?: string };
}

async function spawnSleep(): Promise<number> {
  const child = spawn("sleep", ["30"], { stdio: "ignore" });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  return child.pid as number;
}

describe("launch authority", () => {
  const backend = registry.replay();
  const catalogued: LaunchCatalog = { "test-app": { argv: ["sleep", "30"], env: {} } };

  it("a: an unpermitted known name and an unknown name refuse byte-identically", async () => {
    const context = launch({ catalog: catalogued });
    const known = resultOf(await open("test-app", backend, context));
    const unknown = resultOf(await open("zz-no-such-app", backend, context));
    expect(known.refusal).toBe(UNAVAILABLE_REFUSAL);
    expect(unknown.refusal).toBe(UNAVAILABLE_REFUSAL);
    expect(known.refusal).toBe(unknown.refusal);
    expect(known.application).toBeUndefined();
  });

  it("b: a permitted, catalogued name reaches the spawn", async () => {
    const table = new OwnershipTable();
    const context = launch({ permits: new Set(["test-app"]), catalog: catalogued, table });
    const result = resultOf(await open("test-app", backend, context));
    // the spawned sleep never appears in the accessibility tree, so the poll
    // times out with a refusal naming the wait - but the spawn happened
    expect(table.entries()).toHaveLength(1);
    expect(result.refusal).toContain("did not become readable");
    for (const entry of table.entries()) process.kill(entry.pid, "SIGKILL");
  });

  it("a spawn failure after authority and catalog pass is normalised - no raw system error on the wire", async () => {
    // permitted AND catalogued, but the binary does not exist: Node's spawn
    // ENOENT names argv[0], which must never reach the wire.
    const broken: LaunchCatalog = { "test-app": { argv: ["zz-no-such-binary-m21", "30"], env: {} } };
    const context = launch({ permits: new Set(["test-app"]), catalog: broken });
    const result = resultOf(await open("test-app", backend, context));
    expect(result.refusal).toBe(COULD_NOT_START_REFUSAL);
    expect(result.refusal).not.toContain("zz-no-such-binary-m21");
    expect(result.refusal).not.toContain("ENOENT");
    expect(context.table.entries()).toHaveLength(0);
  });

  it("c: authority runs before capability - an unpermitted name never reaches the catalog or the tree", async () => {
    let catalogTouched = false;
    const trap: LaunchCatalog = new Proxy(
      {},
      {
        get: () => ((catalogTouched = true), undefined),
        ownKeys: () => ((catalogTouched = true), []),
        getOwnPropertyDescriptor: () => ((catalogTouched = true), undefined),
      },
    );
    let treeTouched = false;
    const spy: Backend = {
      name: "spy",
      queryElements: async () => ((treeTouched = true), { elements: [] }),
      attestElement: async () => ((treeTouched = true), {}),
      close: async () => undefined,
    };
    const result = resultOf(await open("test-app", spy, launch({ catalog: trap })));
    expect(result.refusal).toBe(UNAVAILABLE_REFUSAL);
    expect(catalogTouched).toBe(false);
    expect(treeTouched).toBe(false);
  });

  it("a missing or non-string name refuses like any unknown name", async () => {
    const context = launch({ permits: new Set(["test-app"]), catalog: catalogued });
    const missing = resultOf(
      await handleRequest({ type: "request", id: 1, method: "openApplication", params: {} }, backend, context),
    );
    expect(missing.refusal).toBe(UNAVAILABLE_REFUSAL);
  });

  it("d: the refusal names no path, no command, and nothing about what is installed", () => {
    expect(UNAVAILABLE_REFUSAL).not.toContain("/");
    expect(UNAVAILABLE_REFUSAL.toLowerCase()).not.toContain("install");
    expect(UNAVAILABLE_REFUSAL).not.toContain("sleep");
    expect(UNAVAILABLE_REFUSAL).not.toContain("yad");
  });

  it("refuses a running copy the daemon does not own, naming the restart requirement", async () => {
    const context = launch({ permits: new Set(["yad"]), catalog: { yad: { argv: ["sleep", "30"], env: {} } } });
    const result = resultOf(await open("yad", backend, context));
    expect(result.refusal).toBe(ALREADY_RUNNING_REFUSAL);
    expect(result.refusal).toContain("was not opened by this daemon");
    expect(context.table.entries()).toHaveLength(0);
  });

  it("e: an owned, already-running application is returned as-is - no second spawn", async () => {
    const table = new OwnershipTable();
    const pid = await spawnSleep();
    table.record(pid, "yad");
    try {
      const context = launch({ permits: new Set(["yad"]), catalog: { yad: { argv: ["sleep", "30"], env: {} } }, table });
      expect(table.entries()).toHaveLength(1);
      const result = resultOf(await open("yad", backend, context));
      expect(result.refusal).toBeUndefined();
      expect(result.application?.role).toBe("application");
      expect(result.application?.name).toBe("yad");
      expect(table.entries()).toHaveLength(1);
      expect(table.entries()[0]?.pid).toBe(pid);
    } finally {
      process.kill(pid, "SIGKILL");
    }
  });

  it("f: mixed state - ours and a foreign same-name copy both alive - spawns nothing and refuses nothing", async () => {
    // the replay tree's yad IS the foreign copy at this segment's name-only
    // granularity; the recorded sleep is ours. Ours winning means no refusal
    // and no second spawn.
    const table = new OwnershipTable();
    const pid = await spawnSleep();
    table.record(pid, "yad");
    try {
      const context = launch({ permits: new Set(["yad"]), catalog: { yad: { argv: ["sleep", "30"], env: {} } }, table });
      const result = resultOf(await open("yad", backend, context));
      expect(result.refusal).toBeUndefined();
      expect(result.application).toBeDefined();
      expect(table.entries()).toHaveLength(1);
      expect(table.entries()[0]?.pid).toBe(pid);
    } finally {
      process.kill(pid, "SIGKILL");
    }
  });
});

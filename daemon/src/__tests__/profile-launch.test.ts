import { describe, expect, it, vi } from "vitest";
import type { SemanticElement } from "@mastra-cc/protocol-types";
import type { Backend } from "../backend.js";
import { composeCatalog } from "../launch/profiles.js";
import { DEFAULT_CHROME_PROFILE_DIR, type LaunchCatalog } from "../launch/recipes.js";
import { OwnershipTable } from "../launch/table.js";
import {
  ALREADY_RUNNING_REFUSAL,
  ONE_BROWSER_IDENTITY_REFUSAL,
  UNAVAILABLE_REFUSAL,
  handleRequest,
  type LaunchContext,
} from "../server.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// A launched profile is readable, and only one browser identity runs at a time
// (M2.3b, ADR-0038). Offline: spy backends and a real ownership table, no
// browser and no spawn - the poll budget is tiny so no path can wait ten
// seconds or reach a real launch.

const FAST = { pollBudgetMs: 60, pollIntervalMs: 10 };

const PROFILES = [
  { name: "chrome-work", directory: "/var/tmp/m23b-work" },
  { name: "chrome-personal", directory: "/var/tmp/m23b-personal" },
];

// Composition is exercised against the REAL catalog in
// launch/__tests__/profiles.test.ts. Here the base is a stub whose browser
// recipe spawns `sleep`, because these tests reach the spawn path on purpose
// and an offline suite must never start a real browser.
const BASE: LaunchCatalog = {
  yad: { argv: ["sleep", "30"], env: {} },
  chrome: {
    argv: ["sleep", "30", `--user-data-dir=${DEFAULT_CHROME_PROFILE_DIR}`],
    env: {},
    appearsAs: "chrome",
  },
};

const composed = composeCatalog(BASE, PROFILES);

function application(name: string): SemanticElement {
  return { id: `app-${name}`, role: "application", name, content: { kind: "unavailable", reason: "not-exposed" }, actions: [], states: [] };
}

/** A backend that answers with the given application elements and records what it was asked. */
function spyBackend(elements: SemanticElement[]) {
  const asked: string[] = [];
  const backend: Backend = {
    ...observeOnlyEffects,
    name: "spy",
    queryElements: async (query: { name?: string }) => {
      if (typeof query.name === "string") asked.push(query.name);
      return { elements: elements.filter((el) => query.name === undefined || el.name === query.name) };
    },
    attestElement: async () => ({}),
    readElementContent: async () => ({ content: { kind: "unavailable", reason: "not-exposed" } }),
    subscribeElement: async () => {
      throw new Error("this test never watches");
    },
    applicationOfElement: () => undefined,
    unsubscribeElement: async () => undefined,
    close: async () => undefined,
  };
  return { backend, asked };
}

function launch(overrides: Partial<LaunchContext>): LaunchContext {
  return { permits: new Set(), catalog: composed, table: new OwnershipTable(), ...FAST, ...overrides };
}

function open(name: string, backend: Backend, context: LaunchContext) {
  return handleRequest(
    { type: "request", id: 1, method: "openApplication", params: { name } },
    backend,
    context,
  );
}

function resultOf(response: { result?: unknown }) {
  return response.result as { application?: SemanticElement; refusal?: string };
}

describe("a launched profile is readable", () => {
  it("polls for the tree name the recipe declares, not the catalog key", async () => {
    // the browser reports its own product name whichever profile it opened,
    // so a chrome-work launch can only ever be found under "chrome"
    const { backend, asked } = spyBackend([application("chrome")]);
    const table = new OwnershipTable();
    table.record(process.pid, "chrome-work"); // already ours: no spawn, straight to the poll
    const result = resultOf(
      await open("chrome-work", backend, launch({ permits: new Set(["chrome-work"]), table })),
    );
    expect(result.refusal).toBeUndefined();
    expect(result.application?.name).toBe("chrome");
    expect(asked).toContain("chrome");
    expect(asked).not.toContain("chrome-work");
  });

  it("authority runs before the join - an unpermitted identity never reaches the catalog or the tree", async () => {
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
    const backend: Backend = {
      ...observeOnlyEffects,
      name: "spy",
      queryElements: async () => ((treeTouched = true), { elements: [] }),
      attestElement: async () => ((treeTouched = true), {}),
      readElementContent: async () => ({ content: { kind: "unavailable", reason: "not-exposed" } }),
      subscribeElement: async () => {
        treeTouched = true;
        throw new Error("the authority gate touched the backend");
      },
      applicationOfElement: () => undefined,
      unsubscribeElement: async () => {
        treeTouched = true;
      },
      close: async () => undefined,
    };
    const result = resultOf(await open("chrome-work", backend, launch({ catalog: trap })));
    expect(result.refusal).toBe(UNAVAILABLE_REFUSAL);
    expect(catalogTouched).toBe(false);
    expect(treeTouched).toBe(false);
  });

  it("an unpermitted composed identity refuses byte-identically to a name with no recipe at all", async () => {
    const { backend } = spyBackend([]);
    const context = launch({ permits: new Set(["chrome-work"]) });
    const sibling = resultOf(await open("chrome-personal", backend, context));
    const builtIn = resultOf(await open("chrome", backend, context));
    const unknown = resultOf(await open("zz-no-such-identity", backend, context));
    expect(sibling.refusal).toBe(UNAVAILABLE_REFUSAL);
    expect(builtIn.refusal).toBe(UNAVAILABLE_REFUSAL);
    expect(unknown.refusal).toBe(UNAVAILABLE_REFUSAL);
    expect(sibling.refusal).toBe(unknown.refusal);
    expect(builtIn.refusal).toBe(unknown.refusal);
  });
});

describe("only one browser identity runs at a time", () => {
  it("refuses a second identity by name, spawning nothing and signalling nothing", async () => {
    const table = new OwnershipTable();
    table.record(process.pid, "chrome-work"); // a live browser identity of ours
    const { backend, asked } = spyBackend([application("chrome")]);
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const result = resultOf(
        await open(
          "chrome-personal",
          backend,
          launch({ permits: new Set(["chrome-work", "chrome-personal"]), table }),
        ),
      );
      expect(result.refusal).toBe(ONE_BROWSER_IDENTITY_REFUSAL);
      expect(result.application).toBeUndefined();
      // nothing was launched and nothing was signalled to make room
      expect(table.entries()).toHaveLength(1);
      expect(kill).not.toHaveBeenCalled();
      // and the guard answered before anything was asked of the tree
      expect(asked).toEqual([]);
    } finally {
      kill.mockRestore();
    }
  });

  it("names the endpoint, not a process, a path or a raw error", () => {
    expect(ONE_BROWSER_IDENTITY_REFUSAL).toContain("one browser identity at a time");
    expect(ONE_BROWSER_IDENTITY_REFUSAL).not.toContain("/");
    expect(ONE_BROWSER_IDENTITY_REFUSAL).not.toContain("chrome");
    expect(ONE_BROWSER_IDENTITY_REFUSAL).not.toContain("9744");
    expect(ONE_BROWSER_IDENTITY_REFUSAL).not.toMatch(/pid|EADDRINUSE/i);
  });

  it("does not fire for a browser this daemon did not open - that one still says so", async () => {
    // nothing in the table: the running browser is foreign, and the existing
    // refusal is the truthful one for that case
    const { backend } = spyBackend([application("chrome")]);
    const result = resultOf(
      await open("chrome-personal", backend, launch({ permits: new Set(["chrome-personal"]) })),
    );
    expect(result.refusal).toBe(ALREADY_RUNNING_REFUSAL);
  });

  it("does not fire for a dead entry - ownsName re-verifies the process is live", async () => {
    const table = new OwnershipTable();
    table.record(process.pid, "chrome-work");
    for (const entry of table.entries()) entry.starttime = "0"; // same pid, different boot: not ours
    const { backend } = spyBackend([]);
    const context = launch({ permits: new Set(["chrome-personal"]), table });
    try {
      const result = resultOf(await open("chrome-personal", backend, context));
      // the guard stayed quiet, so the request proceeded: it spawned, and the
      // stub's `sleep` never appears in the tree, so the poll budget refuses
      expect(result.refusal).not.toBe(ONE_BROWSER_IDENTITY_REFUSAL);
      expect(result.refusal).toContain("did not become readable");
    } finally {
      for (const entry of table.entries()) {
        if (entry.pid === process.pid) continue; // the stand-in for the dead row is this test itself
        try {
          process.kill(entry.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
  });

  it("re-opening the same identity is still idempotent, not a conflict", async () => {
    const table = new OwnershipTable();
    table.record(process.pid, "chrome-work");
    const { backend } = spyBackend([application("chrome")]);
    const result = resultOf(
      await open("chrome-work", backend, launch({ permits: new Set(["chrome-work"]), table })),
    );
    expect(result.refusal).toBeUndefined();
    expect(result.application?.name).toBe("chrome");
  });

  it("leaves unrelated applications alone - yad answers to its own tree name, not the browser's", async () => {
    const table = new OwnershipTable();
    table.record(process.pid, "chrome-work"); // a browser identity of ours is live
    const { backend } = spyBackend([application("yad")]);
    const result = resultOf(await open("yad", backend, launch({ permits: new Set(["yad"]), table })));
    // no cross-fire: yad's tree name is its own, so the guard has nothing to
    // match, and the already-running answer is the truthful one here
    expect(result.refusal).toBe(ALREADY_RUNNING_REFUSAL);
  });
});

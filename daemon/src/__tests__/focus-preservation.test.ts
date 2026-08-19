import { describe, expect, it } from "vitest";
import type { SemanticElement } from "@mastra-cc/protocol-types";
import { FocusUnsupportedError, type Backend } from "../backend.js";
import type { LaunchCatalog } from "../launch/recipes.js";
import { OwnershipTable } from "../launch/table.js";
import { handleRequest, type LaunchContext } from "../server.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// THE ASSISTANT DOES NOT TAKE THE DESK (ADR-0044).
//
// A launch is a request to start an application. It is not a request to be
// interrupted, so the daemon records what holds the focus before it spawns and
// puts it back afterwards. Every assertion here is about what was READ BACK,
// never about what a call returned: the restore route on this platform is
// exactly the kind of call that can answer true and move nothing (the same
// measured behaviour that makes the whole effect half verify by observation),
// so a test that trusted a return value would pass against a daemon that
// protects nothing.
//
// The doubles below are deliberately not the replay backend: a tape recorded a
// tree, and it cannot move the focus (it refuses both halves, which is its own
// test in the conformance suite). What is under test here is the SERVER's
// behaviour around a route that can, so the route is a double whose focus is a
// variable this file can watch.

const DESK = element("el-00000000dea1", "text", "the message being typed");
const LAUNCHED = element("el-00000000a991", "window", "the launched window");

function element(id: string, role: SemanticElement["role"], name: string): SemanticElement {
  return { id, role, name, states: ["visible"], actions: [] };
}

const APPLICATION: SemanticElement = {
  id: "app-00000000cc01",
  role: "application",
  name: "test-app",
  states: ["enabled", "visible"],
  actions: [],
};

const CATALOGUED: LaunchCatalog = { "test-app": { argv: ["sleep", "30"], env: {} } };

interface Desktop {
  /** what the double reports as focused; the launch is simulated as moving it */
  focus: SemanticElement | undefined;
  /** whether the application has become readable yet */
  readable: boolean;
  /** what restoreFocus does when asked: put it back, lie about it, or refuse */
  restore: "grabs" | "returns-true-and-moves-nothing" | "refuses";
  /** every id restoreFocus was asked for, in order */
  restoreCalls: string[];
  /** how many times the focus was read */
  focusReads: number;
  /** the route cannot read focus at all */
  blind?: boolean;
}

function desktop(overrides: Partial<Desktop> = {}): Desktop {
  return { focus: DESK, readable: false, restore: "grabs", restoreCalls: [], focusReads: 0, ...overrides };
}

// A backend that can be launched into. queryElements answers the application
// only once it is "readable", which is what the poll is waiting for - and the
// launch takes the keyboard at that moment, which is the behaviour ADR-0044
// exists to undo.
function launchable(world: Desktop): Backend {
  return {
    ...observeOnlyEffects,
    name: "launchable-double",
    async queryElements(params: { role?: string; name?: string }) {
      if (params.role !== "application") return { elements: [] };
      if (!world.readable) {
        // the first query is the pre-spawn already-running check; the spawn
        // happens between it and the next one
        world.readable = true;
        return { elements: [] };
      }
      world.focus = LAUNCHED;
      return { elements: [APPLICATION] };
    },
    async attestElement() {
      return {};
    },
    applicationOfElement: () => APPLICATION.name,
    async subscribeElement() {
      throw new Error("not part of this test");
    },
    async unsubscribeElement() {},
    async focusedElement() {
      world.focusReads += 1;
      if (world.blind === true) throw new FocusUnsupportedError("this route cannot say what holds the focus");
      return world.focus;
    },
    async restoreFocus(id: string) {
      world.restoreCalls.push(id);
      if (world.restore === "refuses") throw new FocusUnsupportedError("this route cannot restore the focus");
      // The read-back is the answer in both remaining cases. "grabs" actually
      // moves the focus; the other performs the platform's measured failure -
      // the call succeeds and the world is unchanged - and answers with what
      // actually holds focus, which is what catches it.
      if (world.restore === "grabs") world.focus = world.focus?.id === id ? world.focus : DESK;
      return world.focus;
    },
    async close() {},
  };
}

function launch(overrides: Partial<LaunchContext>): LaunchContext {
  return {
    permits: new Set(["test-app"]),
    catalog: CATALOGUED,
    table: new OwnershipTable(),
    pollBudgetMs: 200,
    pollIntervalMs: 10,
    ...overrides,
  };
}

async function open(backend: Backend, context: LaunchContext) {
  const response = await handleRequest(
    { type: "request", id: 1, method: "openApplication", params: { name: "test-app" } },
    backend,
    context,
  );
  return response.result as { application?: SemanticElement; refusal?: string };
}

function reap(context: LaunchContext) {
  for (const entry of context.table.entries()) {
    try {
      process.kill(entry.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

function focusNote(result: { application?: SemanticElement }): string | undefined {
  const diagnostic = result.application?.diagnostic as Record<string, string> | undefined;
  return diagnostic?.["mastra-cc/focus-preservation"];
}

describe("a launch does not take the desk", () => {
  it("stores the focus before the launch and puts it back afterwards", async () => {
    const world = desktop();
    const context = launch({});
    try {
      const result = await open(launchable(world), context);
      expect(result.refusal).toBeUndefined();
      expect(result.application?.name).toBe("test-app");
      // The launch DID take the focus - without that this test would pass
      // against a daemon that does nothing, because there would be nothing to
      // put back. The double moves it when the application becomes readable.
      expect(world.restoreCalls).toEqual([DESK.id]);
      // And the world reads back the way it did before the launch.
      expect(world.focus?.id).toBe(DESK.id);
      // A launch that protected the focus says nothing about it: the note
      // exists to report failure, and a clean launch is a clean launch.
      expect(focusNote(result)).toBeUndefined();
    } finally {
      reap(context);
    }
  });

  it("reports a restore that reported success and moved nothing, rather than claiming a clean launch", async () => {
    // The measured hazard, in the one place it would be invisible: the
    // platform answers the grab and the keyboard stays where the launch put
    // it. The daemon compares what it asked for against what it read back, so
    // this is caught rather than reported as protection (ADR-0044 clause 4).
    const world = desktop({ restore: "returns-true-and-moves-nothing" });
    const context = launch({});
    try {
      const result = await open(launchable(world), context);
      expect(result.refusal).toBeUndefined();
      expect(world.restoreCalls).toEqual([DESK.id]);
      const note = focusNote(result);
      expect(note).toBeDefined();
      expect(note).toContain("was not restored");
      // Both ends of the fact: what held it, and what holds it now. A note
      // naming neither would tell a reader something went wrong and nothing
      // about what to do.
      expect(note).toContain(DESK.name);
      expect(note).toContain(LAUNCHED.name);
      expect(note).toContain("not a clean launch");
    } finally {
      reap(context);
    }
  });

  it("reports a route that cannot restore focus at all, rather than swallowing the refusal", async () => {
    const world = desktop({ restore: "refuses" });
    const context = launch({});
    try {
      const result = await open(launchable(world), context);
      expect(result.refusal).toBeUndefined();
      expect(world.restoreCalls).toEqual([DESK.id]);
      expect(focusNote(result)).toContain("was not restored");
    } finally {
      reap(context);
    }
  });

  it("reports a route that cannot read focus at all as unmeasured, never as protected", async () => {
    // The FocusUnsupportedError case from the read side. "We could not look"
    // and "we looked and it was fine" are opposite answers to a person
    // deciding whether to trust the keyboard, and collapsing them is the
    // false-belief failure this milestone exists to correct.
    const world = desktop({ blind: true });
    const context = launch({});
    try {
      const result = await open(launchable(world), context);
      expect(result.refusal).toBeUndefined();
      const note = focusNote(result);
      expect(note).toContain("not protected");
      expect(note).toContain("unmeasured");
      // Nothing was restored, because nothing was ever read: a grab aimed at
      // an element this route never named would be a focus change nobody
      // asked for.
      expect(world.restoreCalls).toEqual([]);
    } finally {
      reap(context);
    }
  });

  it("leaves a focus the launch never moved exactly where it is", async () => {
    // Clause 5, at its smallest: putting back what was never taken is itself
    // a focus change nobody asked for. The double's application never grabs
    // the keyboard here, so the daemon must do nothing at all.
    const world = desktop();
    const backend = launchable(world);
    const polite: Backend = {
      ...backend,
      async queryElements(params: { role?: string; name?: string }) {
        const before = world.focus;
        const answer = await backend.queryElements(params as never);
        world.focus = before;
        return answer;
      },
    };
    const context = launch({});
    try {
      const result = await open(polite, context);
      expect(result.refusal).toBeUndefined();
      expect(world.restoreCalls).toEqual([]);
      expect(world.focus?.id).toBe(DESK.id);
      expect(focusNote(result)).toBeUndefined();
    } finally {
      reap(context);
    }
  });

  it("a desktop where nothing holds focus is a real answer, and nothing is restored", async () => {
    const world = desktop({ focus: undefined });
    const context = launch({});
    try {
      const result = await open(launchable(world), context);
      expect(result.refusal).toBeUndefined();
      expect(world.restoreCalls).toEqual([]);
      expect(focusNote(result)).toBeUndefined();
    } finally {
      reap(context);
    }
  });

  it("says the focus was not protected in the same breath as a launch that never became readable", async () => {
    // The refusal path. There is no element to hang a diagnostic on, so the
    // sentence carries it - a launch that both timed out AND left the keyboard
    // somewhere else must not report only half of that.
    const world = desktop({ blind: true });
    const backend = launchable(world);
    const neverReadable: Backend = { ...backend, queryElements: async () => ({ elements: [] }) };
    const context = launch({ pollBudgetMs: 30, pollIntervalMs: 10 });
    try {
      const result = await open(neverReadable, context);
      expect(result.application).toBeUndefined();
      expect(result.refusal).toContain("did not become readable");
      expect(result.refusal).toContain("not protected");
    } finally {
      reap(context);
    }
  });

  it("an application already ours is re-opened without reading or touching the focus", async () => {
    // No spawn, nothing that could take the keyboard, so nothing to protect.
    // A daemon that grabbed focus on an idempotent re-open would be moving the
    // desk for a call that changed nothing.
    const world = desktop({ readable: true });
    const context = launch({});
    const child = (await import("node:child_process")).spawn("sleep", ["30"], { stdio: "ignore" });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    context.table.record(child.pid as number, "test-app");
    try {
      const result = await open(launchable(world), context);
      expect(result.refusal).toBeUndefined();
      expect(result.application?.name).toBe("test-app");
      expect(world.focusReads).toBe(0);
      expect(world.restoreCalls).toEqual([]);
    } finally {
      reap(context);
    }
  });
});

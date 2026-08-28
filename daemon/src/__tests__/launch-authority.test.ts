import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { SemanticElement } from "@mastra-cc/protocol-types";
import type { Backend } from "../backend.js";
import { registry } from "../backends/registry.js";
import { CATALOG, type LaunchCatalog } from "../launch/recipes.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";
import { OwnershipTable } from "../launch/table.js";
import {
  ACTIVATE_SCOPE_REFUSAL,
  ALREADY_RUNNING_REFUSAL,
  BACKEND_UNREADABLE_REFUSAL,
  COULD_NOT_START_REFUSAL,
  EDIT_SCOPE_REFUSAL,
  REVEAL_SCOPE_REFUSAL,
  SET_CARET_SCOPE_REFUSAL,
  SET_TEXT_SCOPE_REFUSAL,
  SET_VALUE_SCOPE_REFUSAL,
  SUBMIT_SCOPE_REFUSAL,
  UNAVAILABLE_REFUSAL,
  handleRequest,
  type LaunchContext,
} from "../server.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// Authority before capability, and the no-leak property (ADR-0019, ADR-0034).
// The refusal-equality assertions use toBe on the exact strings: an unknown
// name and an unpermitted name still answer byte-identically, so guessing
// names at this method teaches a caller nothing.
//
// REWRITTEN FOR ADR-0042. The old reason for that equality was that a refusal
// must never reveal whether an application is installed. It no longer is:
// listApplications names every application this machine has, permitted or not
// (installed-inventory.test.ts). What survives is narrower and still true -
// this METHOD is not where existence is answered, so its refusal says nothing
// about what is installed and a caller learns nothing by probing it. The
// difference matters: existence is now readable in one honest place instead of
// leaking a bit at a time through a gate that was never designed to answer it.
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
  // visibility mirrors the union main.ts composes at boot (a permit implies an
  // observe grant); tests here construct backend and LaunchContext separately,
  // so the tape's yad is granted by hand
  const backend = registry.replay({ visibility: new Set(["yad"]) });
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
    const result = resultOf(await open("test-app", spy, launch({ catalog: trap })));
    expect(result.refusal).toBe(UNAVAILABLE_REFUSAL);
    expect(catalogTouched).toBe(false);
    expect(treeTouched).toBe(false);
  });

  it("an unpermitted gmail refuses byte-identically to an unknown name (M2.5) - the real catalog leaks nothing", async () => {
    // authority runs before capability, so the real catalog's gmail entry is
    // never consulted and no browser can spawn here
    const context = launch({ catalog: DEFANGED_CATALOG });
    const gmail = resultOf(await open("gmail", backend, context));
    const unknown = resultOf(await open("zz-no-such-app", backend, context));
    expect(gmail.refusal).toBe(UNAVAILABLE_REFUSAL);
    expect(gmail.refusal).toBe(unknown.refusal);
    expect(gmail.application).toBeUndefined();
    expect(context.table.entries()).toHaveLength(0);
  });

  it("an unpermitted qt6ct refuses byte-identically to an unknown name (M2.5) - and its recipe bakes the measured knob", async () => {
    // Same authority-before-capability shape as the gmail case above.
    const context = launch({ catalog: DEFANGED_CATALOG });
    const qt6ct = resultOf(await open("qt6ct", backend, context));
    const unknown = resultOf(await open("zz-no-such-app", backend, context));
    expect(qt6ct.refusal).toBe(UNAVAILABLE_REFUSAL);
    expect(qt6ct.refusal).toBe(unknown.refusal);
    expect(context.table.entries()).toHaveLength(0);
    // The enabling is launch-time data (ADR-0027): the one knob that measured
    // true on Qt 6.4 rides the recipe; the Qt5-era QT_ACCESSIBILITY does not
    // (it measured as a no-op and baking it would claim otherwise).
    expect(CATALOG.qt6ct.env.QT_LINUX_ACCESSIBILITY_ALWAYS_ON).toBe("1");
    expect(CATALOG.qt6ct.env.QT_ACCESSIBILITY).toBeUndefined();
    expect(CATALOG.qt6ct.argv).toEqual(["qt6ct"]);
  });

  it("a missing or non-string name refuses like any unknown name", async () => {
    const context = launch({ permits: new Set(["test-app"]), catalog: catalogued });
    const missing = resultOf(
      await handleRequest({ type: "request", id: 1, method: "openApplication", params: {} }, backend, context),
    );
    expect(missing.refusal).toBe(UNAVAILABLE_REFUSAL);
  });

  it("d: the refusal names no path and no command, and points at where existence IS answered", () => {
    // Still true, and for the same reason as before: a path or a command line
    // is content, and this refusal carries none of it.
    expect(UNAVAILABLE_REFUSAL).not.toContain("/");
    expect(UNAVAILABLE_REFUSAL).not.toContain("sleep");
    expect(UNAVAILABLE_REFUSAL).not.toContain("yad");
    // New under ADR-0042: a refusal that cannot be acted on is a wall, so the
    // sentence names the method that answers what this machine has.
    expect(UNAVAILABLE_REFUSAL).toContain("listApplications");
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
    // the replay tree's yad IS the foreign copy at the current name-only
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

// The timing half of B11 for the three element verbs. The pin
// (tools/pins/b11.mjs) reads the dispatch table's DECLARATION; these assert the
// declaration is true of the running code - that a session without the class is
// refused BEFORE the backend is touched. That distinction is the whole point:
// an edit filtered at result time has already typed into the field, and a
// submit filtered at result time has already sent the email.
//
// The authority driven here is the one the server composes at boot from
// --allow. It is authority, NOT the per-application capability configuration -
// that surface lives in capability-configuration.test.ts and hangs inside
// holdsEffectAuthority, which already takes the application it will decide
// about.
//
// Seven methods, not three: the four operations the wire used to answer with a
// constant now route to the same seam through the same gate, so they are
// subject to the same timing property and are driven here alongside the verbs.
describe("effect authority: every element method is refused before the backend is reached", () => {
  // Every method throws. If any verb reaches this backend to produce its
  // refusal, the test fails loudly instead of passing on a refusal that came
  // from the wrong place.
  const untouchable: Backend = {
    name: "untouchable",
    queryElements: async () => {
      throw new Error("the effect authority gate touched the backend");
    },
    installedApplications: async () => {
      throw new Error("the effect authority gate touched the backend");
    },
    attestElement: async () => {
      throw new Error("the effect authority gate touched the backend");
    },
    readElementContent: async () => {
      throw new Error("the effect authority gate touched the backend");
    },
    subscribeElement: async () => {
      throw new Error("the effect authority gate touched the backend");
    },
    applicationOfElement: () => undefined,
    unsubscribeElement: async () => {
      throw new Error("the effect authority gate touched the backend");
    },
    focusedElement: async () => {
      throw new Error("the effect authority gate touched the backend");
    },
    restoreFocus: async () => {
      throw new Error("the effect authority gate touched the backend");
    },
    editElement: async () => {
      throw new Error("the effect authority gate touched the backend");
    },
    activateElement: async () => {
      throw new Error("the effect authority gate touched the backend");
    },
    submitElement: async () => {
      throw new Error("the effect authority gate touched the backend");
    },
    setElementValue: async () => {
      throw new Error("the effect authority gate touched the backend");
    },
    setElementText: async () => {
      throw new Error("the effect authority gate touched the backend");
    },
    setElementCaret: async () => {
      throw new Error("the effect authority gate touched the backend");
    },
    revealElement: async () => {
      throw new Error("the effect authority gate touched the backend");
    },
    close: async () => undefined,
  };

  const call = async (method: string, params: Record<string, unknown>, context: LaunchContext) => {
    const response = await handleRequest({ type: "request", id: 1, method, params }, untouchable, context);
    return response.result as { element?: SemanticElement; refusal?: string };
  };

  const cases = [
    { method: "editElement", params: { id: "el-000000000000", value: "typed" }, refusal: EDIT_SCOPE_REFUSAL, allow: "edit" },
    { method: "activateElement", params: { id: "el-000000000000", action: "click" }, refusal: ACTIVATE_SCOPE_REFUSAL, allow: "activate" },
    { method: "submitElement", params: { id: "el-000000000000", attestation: "sends the message" }, refusal: SUBMIT_SCOPE_REFUSAL, allow: "submit" },
    { method: "setElementValue", params: { id: "el-000000000000", value: 3 }, refusal: SET_VALUE_SCOPE_REFUSAL, allow: "edit" },
    { method: "setElementText", params: { id: "el-000000000000", text: "typed" }, refusal: SET_TEXT_SCOPE_REFUSAL, allow: "edit" },
    { method: "setElementCaret", params: { id: "el-000000000000", offset: 0 }, refusal: SET_CARET_SCOPE_REFUSAL, allow: "edit" },
    { method: "revealElement", params: { id: "el-000000000000" }, refusal: REVEAL_SCOPE_REFUSAL, allow: "activate" },
  ];

  for (const { method, params, refusal } of cases) {
    it(`${method} is refused before the call when this session holds no authority for its class`, async () => {
      const result = await call(method, params, launch({ allows: new Set() }));
      expect(result.refusal).toBe(refusal);
      expect(result.element).toBeUndefined();
    });
  }

  it("every refusal is answerable with no desktop at all - none of them names an element", async () => {
    // A refusal derived from the element would need the element read, which is
    // a backend call this session's authority never earned (ADR-0008 clause 5:
    // a refusal must be derived from a check that actually ran - and the check
    // that ran here is the authority one).
    for (const { params, refusal } of cases) {
      expect(refusal).not.toContain(params.id as string);
      expect(refusal).toContain("scope gate");
    }
  });

  it("holding one class does not grant another - the classes are separate authorities", async () => {
    // A session given edit must still be refused activate and submit. The
    // failure this pins is a gate that checks "holds any effect class at all",
    // which would make --allow edit a grant to send email.
    const editOnly = launch({ allows: new Set(["edit"]) });
    for (const { method, params, refusal, allow } of cases) {
      if (allow === "edit") continue;
      const result = await call(method, params, editOnly);
      expect(result.refusal).toBe(refusal);
    }
  });

  it("holding the class gets past the gate and reaches the backend", async () => {
    // The other side of the same property, and the reason the tests above are
    // not vacuous: with the class held, the verb DOES reach the backend - the
    // untouchable one, whose throw becomes the daemon's one honest constant.
    // A gate that refused everything unconditionally would pass every
    // assertion above and fail this one.
    //
    // The refusal arrives at the RESPONSE level rather than inside a result:
    // a backend that threw produced no result to carry one, and the scope gate
    // never reached is the whole point.
    for (const { method, params, allow } of cases) {
      const response = await handleRequest(
        { type: "request", id: 1, method, params },
        untouchable,
        launch({ allows: new Set([allow]) }),
      );
      expect(response.refusal).toBe(BACKEND_UNREADABLE_REFUSAL);
      expect(response.result).toBeUndefined();
    }
  });
});

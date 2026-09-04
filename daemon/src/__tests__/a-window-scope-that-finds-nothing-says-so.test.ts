import { describe, expect, it } from "vitest";
import type { Backend } from "../backend.js";
import { WindowScopeAmbiguousError, WindowScopeUnmatchedError } from "../backend.js";
import { OwnershipTable } from "../launch/table.js";
import { handleRequest, type LaunchContext, WINDOW_SCOPE_AMBIGUOUS_REFUSAL, WINDOW_SCOPE_UNMATCHED_REFUSAL } from "../server.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// A window scope is a question about ONE window. When no window answers to the
// name, or several do, the daemon used to hand back an empty list - a sentence
// about the window's contents that it had no grounds for. Measured on a Plasma
// file dialog, which publishes two visible top-levels of the same name: the
// scoped questions came back empty, and the agent asking them concluded the
// dialog had no controls at all and stopped. These tests pin the two refusals.
function backendThatThrows(error: Error): Backend {
  return {
    name: "scope-fixture",
    ...observeOnlyEffects,
    queryElements: async () => {
      throw error;
    },
    discoverElements: async () => {
      throw error;
    },
    applicationOfElement: () => undefined,
    close: () => undefined,
  } as unknown as Backend;
}

function ask(method: "queryElements" | "discoverElements", backend: Backend) {
  return handleRequest({ type: "request", id: 1, method, params: { application: "app", window: "Open Image" } }, backend, {
    permits: new Set(),
    catalog: DEFANGED_CATALOG,
    table: new OwnershipTable(),
    visibility: "all",
  } as unknown as LaunchContext);
}

function refusalIn(answer: { refusal?: string; result?: unknown }): string | undefined {
  return answer.refusal ?? (answer.result as { refusal?: string } | undefined)?.refusal;
}

describe("a window scope that resolves to no single window", () => {
  it.each(["queryElements", "discoverElements"] as const)("%s refuses a name no window answers to", async (method) => {
    const answer = await ask(method, backendThatThrows(new WindowScopeUnmatchedError("no visible window named x")));
    expect(refusalIn(answer as never)).toBe(WINDOW_SCOPE_UNMATCHED_REFUSAL);
  });

  it.each(["queryElements", "discoverElements"] as const)("%s refuses a name several windows answer to", async (method) => {
    const answer = await ask(method, backendThatThrows(new WindowScopeAmbiguousError("2 visible windows named x")));
    expect(refusalIn(answer as never)).toBe(WINDOW_SCOPE_AMBIGUOUS_REFUSAL);
  });

  it("says which repair each case needs, so the two are not one sentence", () => {
    expect(WINDOW_SCOPE_UNMATCHED_REFUSAL).not.toBe(WINDOW_SCOPE_AMBIGUOUS_REFUSAL);
    expect(WINDOW_SCOPE_UNMATCHED_REFUSAL).toContain("no visible window");
    expect(WINDOW_SCOPE_AMBIGUOUS_REFUSAL).toContain("more than one");
  });

  it("leaves an unrelated backend failure alone - only the scope errors become these sentences", async () => {
    const answer = await ask("queryElements", backendThatThrows(new Error("the bus went away")));
    expect(refusalIn(answer as never)).not.toBe(WINDOW_SCOPE_UNMATCHED_REFUSAL);
    expect(refusalIn(answer as never)).not.toBe(WINDOW_SCOPE_AMBIGUOUS_REFUSAL);
  });
});

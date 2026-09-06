import { describe, expect, it } from "vitest";
import type { Backend } from "../backend.js";
import {
  ApplicationScopeAmbiguousError,
  ApplicationScopeUnmatchedError,
  WindowScopeAmbiguousError,
  WindowScopeUnmatchedError,
} from "../backend.js";
import { OwnershipTable } from "../launch/table.js";
import {
  APPLICATION_SCOPE_AMBIGUOUS_REFUSAL,
  APPLICATION_SCOPE_UNMATCHED_REFUSAL,
  handleRequest,
  type LaunchContext,
  WINDOW_SCOPE_AMBIGUOUS_REFUSAL,
  WINDOW_SCOPE_UNMATCHED_REFUSAL,
} from "../server.js";
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

function ask(method: "queryElements" | "discoverElements", backend: Backend, window = "Open Image") {
  return handleRequest({ type: "request", id: 1, method, params: { application: "app", window } }, backend, {
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

  // Measured on the desk: an agent that had just been answered with
  // win-ef83fb73e9da passed that id back as the window scope, was told the name
  // matched nothing, and spent its next turns hunting a window that was there
  // all along. The id is the mistake, so the refusal names it.
  it.each(["queryElements", "discoverElements"] as const)("%s says so when the scope is an id rather than a name", async (method) => {
    const answer = await ask(method, backendThatThrows(new WindowScopeUnmatchedError("no visible window named x")), "win-ef83fb73e9da");
    const refusal = refusalIn(answer as never) ?? "";
    expect(refusal).toContain(WINDOW_SCOPE_UNMATCHED_REFUSAL);
    expect(refusal).toContain("win-ef83fb73e9da");
    expect(refusal).toContain("is an id this daemon answers WITH");
  });

  it("leaves an ordinary name unadorned, so the hint means what it says", async () => {
    const answer = await ask("queryElements", backendThatThrows(new WindowScopeUnmatchedError("no visible window named x")), "Downloads");
    expect(refusalIn(answer as never)).toBe(WINDOW_SCOPE_UNMATCHED_REFUSAL);
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

describe("an application scope that resolves to no single application", () => {
  it.each(["queryElements", "discoverElements"] as const)("%s refuses a name no application answers to", async (method) => {
    const answer = await ask(method, backendThatThrows(new ApplicationScopeUnmatchedError("no application named x")));
    expect(refusalIn(answer as never)).toBe(APPLICATION_SCOPE_UNMATCHED_REFUSAL);
  });

  it.each(["queryElements", "discoverElements"] as const)("%s refuses a name several applications answer to", async (method) => {
    const answer = await ask(method, backendThatThrows(new ApplicationScopeAmbiguousError("2 applications named x")));
    expect(refusalIn(answer as never)).toBe(APPLICATION_SCOPE_AMBIGUOUS_REFUSAL);
  });

  // The name the caller guessed was a launcher id; the bus publishes another.
  // The refusal has to point at the one call that reconciles the two, or it
  // leaves the caller exactly where the empty answer did.
  it("sends the caller to listApplications, which is where the real name is", () => {
    expect(APPLICATION_SCOPE_UNMATCHED_REFUSAL).toContain("listApplications");
    expect(APPLICATION_SCOPE_AMBIGUOUS_REFUSAL).toContain("listApplications");
    expect(APPLICATION_SCOPE_UNMATCHED_REFUSAL).not.toBe(APPLICATION_SCOPE_AMBIGUOUS_REFUSAL);
  });
});

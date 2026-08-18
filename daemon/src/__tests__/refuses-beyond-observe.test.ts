import type { Backend } from "../backend.js";
import { describe, expect, it } from "vitest";
import { registry } from "../backends/registry.js";
import { CATALOG } from "../launch/recipes.js";
import { OwnershipTable } from "../launch/table.js";
import { EDIT_SCOPE_REFUSAL, handleRequest } from "../server.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// Anything the schema does not define is refused with the check named
// (ADR-0019: capability is not authority). Since M2.1 the dispatch table
// carries one activate-class entry - openApplication - whose enforcement
// timing B11 pins; since M2.3 (schema 1.2.0, ADR-0037) the edit, activate and
// submit element methods are DEFINED; everything else beyond the schema still
// dies at the gate.
//
// What changed under those three verbs, and what did not: the seam behind them
// now performs, and every session in this file is started without effect
// authority, so the scope gate still answers each call. That is why these tests
// are kept rather than rewritten - the refusal is now a DECISION rather than
// the only thing the daemon could do, and a decision has to keep answering the
// same way for a session that holds nothing. The authority-held direction, and
// the timing of the check, live in launch-authority.test.ts.

describe("the effect-class gate", () => {
  // visibility mirrors the union main.ts composes at boot: the tape's yad must
  // be findable or the openApplication handler escapes into a real spawn
  const backend = registry.replay({ visibility: new Set(["yad"]) });

  it("refuses a method the schema does not define, naming the gate", async () => {
    // destroyElement stays unknown deliberately: the destructive class has no
    // methods, and that absence is itself doctrine (ADR-0037)
    const response = await handleRequest({ type: "request", id: 1, method: "destroyElement", params: {} }, backend);
    expect(response.refusal).toContain("effect-class gate");
    expect(response.refusal).toContain("destroyElement");
    expect(response.refusal).toContain("schema");
    expect(response.result).toBeUndefined();
  });

  it("serves both observe-class methods the schema defines", async () => {
    const query = await handleRequest({ type: "request", id: 2, method: "queryElements", params: {} }, backend);
    expect(query.refusal).toBeUndefined();
    expect((query.result as { elements: unknown[] }).elements.length).toBeGreaterThan(0);

    const attest = await handleRequest(
      { type: "request", id: 3, method: "attestElement", params: { id: "el-000000000000" } },
      backend,
    );
    // an unknown id is a backend refusal inside a served method, not a gate refusal
    expect(attest.refusal).toBeUndefined();
    expect((attest.result as { refusal?: string }).refusal).toContain("el-000000000000");
  });

  it("no longer refuses openApplication at the gate when the session permits it", async () => {
    // Permitted, so the gate and the authority check both pass; the tape's
    // yad is already running and unowned, so the result is a served-method
    // refusal - which is the point: the class gate did not fire.
    const response = await handleRequest(
      { type: "request", id: 4, method: "openApplication", params: { name: "yad" } },
      backend,
      { permits: new Set(["yad"]), catalog: CATALOG, table: new OwnershipTable(), pollBudgetMs: 50, pollIntervalMs: 10 },
    );
    expect(response.refusal).toBeUndefined();
    expect(response.result).toBeDefined();
  });
});

describe("the scope gate: a session holding no effect authority is refused by name", () => {
  const backend = registry.replay({ visibility: new Set(["yad"]) });

  it("refuses editElement with the full byte-stable constant", async () => {
    const response = await handleRequest(
      { type: "request", id: 5, method: "editElement", params: { id: "el-000000000000", value: "x" } },
      backend,
    );
    expect(response.refusal).toBeUndefined();
    // a served-method refusal, byte-stable: the constant IS the contract
    expect((response.result as { refusal?: string }).refusal).toBe(EDIT_SCOPE_REFUSAL);
  });

  it("refuses activateElement naming the scope gate, the method and its class", async () => {
    const response = await handleRequest(
      { type: "request", id: 6, method: "activateElement", params: { id: "el-000000000000", action: "click" } },
      backend,
    );
    const refusal = (response.result as { refusal?: string }).refusal;
    expect(refusal).toContain("scope gate");
    expect(refusal).toContain("activateElement");
    expect(refusal).toContain("activate-class");
  });

  it("refuses submitElement naming the scope gate, the method and its class", async () => {
    const response = await handleRequest(
      { type: "request", id: 7, method: "submitElement", params: { id: "el-000000000000", attestation: "sends nothing" } },
      backend,
    );
    const refusal = (response.result as { refusal?: string }).refusal;
    expect(refusal).toContain("scope gate");
    expect(refusal).toContain("submitElement");
    expect(refusal).toContain("submit-class");
  });

  it("never touches the backend to refuse", async () => {
    // every backend method throws if called: the refusal must be answerable
    // without a desktop existing at all
    const untouchable: Backend = {
      ...observeOnlyEffects,
      name: "untouchable",
      queryElements: async () => {
        throw new Error("the scope gate touched the backend");
      },
      attestElement: async () => {
        throw new Error("the scope gate touched the backend");
      },
      subscribeElement: async () => {
        throw new Error("the scope gate touched the backend");
      },
      applicationOfElement: () => undefined,
      unsubscribeElement: async () => {
        throw new Error("the scope gate touched the backend");
      },
      close: async () => {
        throw new Error("the scope gate touched the backend");
      },
    };
    for (const [id, method, params] of [
      [8, "editElement", { id: "el-000000000000", value: "x" }],
      [9, "activateElement", { id: "el-000000000000", action: "click" }],
      [10, "submitElement", { id: "el-000000000000", attestation: "commits nothing" }],
    ] as const) {
      const response = await handleRequest({ type: "request", id, method, params }, untouchable);
      expect(response.refusal).toBeUndefined();
      expect((response.result as { refusal?: string }).refusal).toContain("scope gate");
    }
  });
});

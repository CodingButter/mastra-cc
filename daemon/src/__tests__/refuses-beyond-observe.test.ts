import { describe, expect, it } from "vitest";
import { registry } from "../backends/registry.js";
import { CATALOG } from "../launch/recipes.js";
import { OwnershipTable } from "../launch/table.js";
import { handleRequest } from "../server.js";

// Anything the schema does not define is refused with the check named
// (ADR-0019: capability is not authority). Since M2.1 the dispatch table
// carries one activate-class entry - openApplication - whose enforcement
// timing B11 pins; everything else beyond the schema still dies at the gate.

describe("the effect-class gate", () => {
  // visibility mirrors the union main.ts composes at boot: the tape's yad must
  // be findable or the openApplication handler escapes into a real spawn
  const backend = registry.replay({ visibility: new Set(["yad"]) });

  it("refuses a method the schema does not define, naming the gate", async () => {
    const response = await handleRequest({ type: "request", id: 1, method: "editElement", params: {} }, backend);
    expect(response.refusal).toContain("effect-class gate");
    expect(response.refusal).toContain("editElement");
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

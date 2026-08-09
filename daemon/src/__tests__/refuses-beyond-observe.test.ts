import { describe, expect, it } from "vitest";
import { LoopbackBackend } from "../backends/loopback.js";
import { handleRequest } from "../server.js";

// Anything beyond observe is refused with the check named (ADR-0019:
// capability is not authority). M1's schema defines only observe-class
// methods, so the refusal path must exist before the first effect-class
// method does - B11 will pin its timing when M2 lands one.

describe("the daemon refuses anything beyond observe", () => {
  const backend = new LoopbackBackend();

  it("refuses a method the schema does not define, naming the effect-class gate", async () => {
    const response = await handleRequest({ type: "request", id: 1, method: "editElement", params: {} }, backend);
    expect(response.refusal).toContain("effect-class gate");
    expect(response.refusal).toContain("editElement");
    expect(response.refusal).toContain("observe");
    expect(response.result).toBeUndefined();
  });

  it("serves the two observe-class methods the schema defines", async () => {
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
});

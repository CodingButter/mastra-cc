import { describe, expect, it } from "vitest";
import { ROLES, validateSemanticElement } from "@mastra-cc/protocol-types";
import { BACKEND_METHODS } from "../backend.js";
import { LIVE_BACKENDS, registry } from "../backends/registry.js";

// Live-lane gating: backends that need a real desktop run through this suite
// only when MASTRA_CC_LIVE=1 (a machine with an accessibility bus). CI runs
// the --no-live lane; the skip is loud in the reporter, never silent.
const LIVE = process.env.MASTRA_CC_LIVE === "1";

// The shared conformance suite: the seam's enforcement arm. The backend
// interface defines what every backend must implement; this suite is what
// makes that binding ("thats what our tests are for though"). Every backend in
// the registry - at-spi on the live lane, replay on the default lane - runs
// through the same assertions. A backend that is not in the registry does not
// exist as far as the daemon is concerned. (The loopback wire double served
// Phase 3 and was deleted in Phase 5, replaced by recordings of a real tree.)

for (const [name, factory] of Object.entries(registry)) {
  const suite = LIVE_BACKENDS.has(name) && !LIVE ? describe.skip : describe;
  const lane = LIVE_BACKENDS.has(name) ? " (live lane: MASTRA_CC_LIVE=1)" : "";
  suite(`backend "${name}" conforms to the backend interface${lane}`, { timeout: 120_000 }, () => {
    // visibility "all": this suite's job is reader conformance, not grant
    // policy - deny-by-default (ADR-0036) is witnessed by invisibility.test.ts
    const backend = factory({ visibility: "all" });

    it("implements every method the interface names", () => {
      for (const method of BACKEND_METHODS) {
        expect(typeof backend[method], `backend "${name}" is missing ${method}()`).toBe("function");
      }
      expect(backend.name).toBe(name);
    });

    it("answers queryElements with elements that validate against the schema", async () => {
      const { elements } = await backend.queryElements({});
      expect(elements.length).toBeGreaterThan(0);
      for (const element of elements) {
        expect(validateSemanticElement(element)).toEqual([]);
      }
    });

    it("emits only neutral roles, never platform vocabulary", async () => {
      const { elements } = await backend.queryElements({});
      for (const element of elements) {
        expect(ROLES).toContain(element.role);
      }
    });

    it("attests an element it previously answered", async () => {
      const { elements } = await backend.queryElements({});
      const attested = await backend.attestElement({ id: elements[0].id });
      expect(attested.element?.id).toBe(elements[0].id);
      expect(attested.refusal).toBeUndefined();
    });

    it("refuses an unknown element with a named refusal, not an empty success", async () => {
      const attested = await backend.attestElement({ id: "el-000000000000" });
      expect(attested.element).toBeUndefined();
      expect(attested.refusal).toContain("el-000000000000");
    });
  });
}

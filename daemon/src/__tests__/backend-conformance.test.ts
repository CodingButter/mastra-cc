import { describe, expect, it } from "vitest";
import { ROLES, validateSemanticElement } from "@mastra-cc/protocol-types";
import { BACKEND_METHODS } from "../backend.js";
import { registry } from "../backends/registry.js";

// The shared conformance suite: the seam's enforcement arm. The backend
// interface defines what every backend must implement; this suite is what
// makes that binding ("thats what our tests are for though"). Every backend in
// the registry - loopback today, at-spi in Phase 4, replay in Phase 5 - runs
// through the same assertions. A backend that is not in the registry does not
// exist as far as the daemon is concerned.

for (const [name, factory] of Object.entries(registry)) {
  describe(`backend "${name}" conforms to the backend interface`, () => {
    const backend = factory();

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

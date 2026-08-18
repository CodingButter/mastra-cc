import { describe, expect, it } from "vitest";
import { ROLES, validateSemanticElement } from "@mastra-cc/protocol-types";
import { BACKEND_METHODS, UnknownSubscriptionError, WatchUnsupportedError } from "../backend.js";
import { VISIBILITY_ROUTE as ACCESSIBILITY_BUS_ROUTE } from "../backends/atspi/roles.js";
import { VISIBILITY_ROUTE as BROWSER_PROTOCOL_ROUTE } from "../backends/cdp/roles.js";
import { LIVE_BACKENDS, registry } from "../backends/registry.js";

// ADR-0040: which instrument each registry backend answers through. The
// replay flavours run the SAME reader as their live counterpart, so a
// replayed answer carries the route of the instrument the tape recorded.
const EXPECTED_ROUTE: Record<string, string> = {
  atspi: ACCESSIBILITY_BUS_ROUTE,
  replay: ACCESSIBILITY_BUS_ROUTE,
  cdp: BROWSER_PROTOCOL_ROUTE,
  "cdp-replay": BROWSER_PROTOCOL_ROUTE,
};

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

    // ADR-0043's cost, made a test. A closed enum could be asserted
    // exhaustively; a vocabulary read off live applications cannot, so
    // conformance asserts INVARIANTS about actions rather than a list of them.
    //
    // This is deliberately not a parity assertion. The two routes have
    // genuinely different fidelity - the accessibility bus publishes an Action
    // interface that names its own verbs, while a browser node publishes no
    // verb at all and the route derives one from properties it did publish.
    // Requiring identical answers would force one route to invent the other's.
    // What must hold on both is that no answer was predicted from the role.
    it("publishes named actions and never the word the deleted tables invented", async () => {
      const { elements } = await backend.queryElements({});
      expect(elements.length).toBeGreaterThan(0); // a vacuous pass would satisfy the loops below

      // A nameless action is the shape of a reader that trusted a bulk reply:
      // measured on this machine, 10 of 263 elements answered a bulk action
      // query with all-empty names while naming them one index at a time.
      for (const element of elements) {
        for (const action of element.actions) {
          expect(
            action.name.length,
            `backend "${name}" published a nameless action`,
          ).toBeGreaterThan(0);
        }
      }

      // "press" was the deleted tables' word for a button, and no platform
      // measured here has ever published it on either route. Its reappearance
      // means a role-keyed table came back under some new name.
      const published = new Set(elements.flatMap((e) => e.actions.map((a) => a.name)));
      expect(published.has("press"), `backend "${name}" published "press", a word this project invented`).toBe(false);
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

    // The subscription half of the seam (ADR-0039). A route that cannot watch
    // anything yet still conforms - by REFUSING BY NAME. What no backend may
    // do is accept a watch and then say nothing, because that is
    // indistinguishable from a quiet desktop.
    it("either watches an element it answered or refuses the watch by name", async () => {
      const { elements } = await backend.queryElements({});
      let subscription: Awaited<ReturnType<typeof backend.subscribeElement>> | undefined;
      try {
        subscription = await backend.subscribeElement(elements[0].id, () => undefined);
      } catch (error) {
        expect(error, `backend "${name}" must refuse a watch by name, never with a raw error`).toBeInstanceOf(
          WatchUnsupportedError,
        );
        return;
      }
      expect(subscription.subscriptionId).not.toBe("");
      expect(subscription.application).not.toBe("");
      // Two watches on the same element are two different watches: a client
      // holding both must be able to end one of them.
      const second = await backend.subscribeElement(elements[0].id, () => undefined);
      expect(second.subscriptionId).not.toBe(subscription.subscriptionId);
      await backend.unsubscribeElement(second.subscriptionId);
      await backend.unsubscribeElement(subscription.subscriptionId);
    });

    it("refuses a watch on an element it never answered, echoing the id", async () => {
      await expect(backend.subscribeElement("el-000000000000", () => undefined)).rejects.toThrow(/el-000000000000/);
    });

    it("refuses to end a watch it does not hold, by name rather than by raw error", async () => {
      await expect(backend.unsubscribeElement("sub-000000-000000")).rejects.toBeInstanceOf(UnknownSubscriptionError);
    });

    // ADR-0040: a visibility verdict carries its route. Every element answer
    // names the instrument that produced it in the namespaced diagnostic
    // field - so a downstream reader can weight "visible" by which instrument
    // said so, instead of trusting a bare verdict.
    it("stamps every element answer with the visibility route naming its own instrument", async () => {
      const { elements } = await backend.queryElements({});
      expect(elements.length).toBeGreaterThan(0);
      for (const element of elements) {
        const diagnostic = element.diagnostic as Record<string, unknown> | undefined;
        expect(diagnostic?.["mastra-cc/visibility-route"], `backend "${name}"`).toBe(EXPECTED_ROUTE[name]);
      }
    });
  });
}

// The route is provenance, not decoration: if both backends declared the same
// label, the stamp would say nothing about WHICH instrument answered.
describe("the visibility route distinguishes the instruments (ADR-0040)", () => {
  it("the two backends name different routes", () => {
    expect(ACCESSIBILITY_BUS_ROUTE).not.toBe(BROWSER_PROTOCOL_ROUTE);
  });
});

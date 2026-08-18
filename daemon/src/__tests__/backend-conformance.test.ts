import { describe, expect, it } from "vitest";
import { ROLES, validateSemanticElement } from "@mastra-cc/protocol-types";
import type { Backend } from "../backend.js";
import {
  AttestationFailedError,
  BACKEND_METHODS,
  EffectUnsupportedError,
  MagnitudeOutOfRangeError,
  OperationNotExposedError,
  RecordingNotPerformableError,
  TextOffsetOutOfRangeError,
  UnknownSubscriptionError,
  UnperformableElementError,
  UnpublishedActionError,
  WatchUnsupportedError,
  WriteNotObservedError,
} from "../backend.js";

// The seam's whole refusal vocabulary. A route that cannot do something says so
// in one of these; anything else reaching a caller is an unhandled failure, and
// the conformance suite is where that distinction is kept honest.
const REFUSAL_CLASSES = [
  AttestationFailedError,
  EffectUnsupportedError,
  MagnitudeOutOfRangeError,
  OperationNotExposedError,
  RecordingNotPerformableError,
  TextOffsetOutOfRangeError,
  UnperformableElementError,
  UnpublishedActionError,
  WriteNotObservedError,
] as const;
import { AtspiBackend } from "../backends/atspi/index.js";
import { CdpBackend } from "../backends/cdp/index.js";
import { replayCdpChannel } from "../backends/cdp/channel.js";
import { replayChannel } from "../backends/replay/index.js";
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

    // THE EFFECT HALF.
    //
    // A verb either performs or refuses BY NAME - there is no third answer, and
    // the assertion below is written to make the third answer impossible to
    // ship. A route that quietly returned the element unchanged would look
    // exactly like a route that worked, which is the failure the observe half
    // already refuses to allow for a silent watch (WatchUnsupportedError).
    //
    // The refusal branch is not a weaker pass. Routes genuinely differ in what
    // they can do - a recording cannot be acted upon at all - and ADR-0040's
    // whole posture is that unequal fidelity stays visible rather than being
    // faked into parity. What conformance pins is that the difference is
    // ANNOUNCED, in a class a caller can catch.
    //
    // WHAT THIS AIMS AT, on the live lane. Every verb below is real there, and
    // elements[0] is whatever the operator's desktop happened to answer first.
    // A single-verb element in that position would be COMMITTED - the suite
    // would click a stranger's button to prove a point about error classes.
    // So the live lane aims at an id no application answers: the refusal for an
    // unanswered id is byte-identical to the refusal for one that never existed
    // (ADR-0008 rule 6), which is exactly the "refuses by name" branch this
    // test asserts, reached without touching anyone's window. The replay lanes
    // keep aiming at a real recorded element, because a tape cannot be harmed
    // and the performing branch has to be exercised somewhere.
    it("either performs an effect or refuses it by name, never silently doing nothing", async () => {
      const { elements } = await backend.queryElements({});
      const id = LIVE_BACKENDS.has(name) ? "el-000000000000" : elements[0].id;
      const attempts: [string, () => Promise<{ element?: unknown }>][] = [
        ["editElement", () => backend.editElement({ id, value: "conformance" })],
        ["activateElement", () => backend.activateElement({ id, action: "click" })],
        ["submitElement", () => backend.submitElement({ id, attestation: "conformance" })],
        ["setElementValue", () => backend.setElementValue({ id, value: 0 })],
        ["setElementText", () => backend.setElementText({ id, text: "conformance" })],
        ["setElementCaret", () => backend.setElementCaret({ id })],
        ["revealElement", () => backend.revealElement({ id })],
      ];
      for (const [verb, attempt] of attempts) {
        try {
          const result = await attempt();
          // Performed. Then the contract's other half holds: the answer is a
          // re-read of the tree, not an echo, so it must be a real element.
          expect(result.element, `backend "${name}" answered ${verb} without the element it claims to have changed`)
            .toBeDefined();
          expect(validateSemanticElement(result.element as Parameters<typeof validateSemanticElement>[0])).toEqual([]);
        } catch (error) {
          // "By name" means one of the seam's OWN classes. Accepting any Error
          // with a non-empty message would have been satisfied by a TypeError
          // from a bug inside the verb, which is the opposite of announcing a
          // difference - it is a crash wearing a refusal's clothes.
          expect(
            REFUSAL_CLASSES.some((refusal) => error instanceof refusal),
            `backend "${name}" failed ${verb} with ${(error as Error)?.constructor?.name ?? typeof error}, which is not one of the seam's refusal classes - a route that cannot perform must say so by name`,
          ).toBe(true);
          expect(
            (error as Error).message,
            `backend "${name}" refused ${verb} without saying anything`,
          ).not.toBe("");
        }
      }
    });

    it("refuses an effect on an element it never answered", async () => {
      // Byte-identical to the refusal for an element that does not exist: the
      // refusal must not become an existence oracle (ADR-0008 rule 6).
      await expect(backend.editElement({ id: "el-000000000000", value: "x" })).rejects.toBeInstanceOf(Error);
    });
  });
}

// A recording cannot be acted upon, and both replay flavours must say so rather
// than inventing an outcome - the performing-side twin of the mutation
// `replay-invents-a-reply-for-an-unrecorded-exchange`. This is asserted
// SEPARATELY from the conformance loop above, which accepts either answer:
// here, performing at all is the failure.
describe("a recording refuses to be acted upon", () => {
  for (const name of ["replay", "cdp-replay"] as const) {
    it(`backend "${name}" refuses every effect verb by name`, async () => {
      const backend = registry[name]({ visibility: "all" });
      const { elements } = await backend.queryElements({});
      expect(elements.length).toBeGreaterThan(0);
      const id = elements[0].id;
      const attempts: [string, () => Promise<unknown>][] = [
        ["editElement", () => backend.editElement({ id, value: "x" })],
        ["activateElement", () => backend.activateElement({ id, action: "click" })],
        ["submitElement", () => backend.submitElement({ id, attestation: "x" })],
        ["setElementValue", () => backend.setElementValue({ id, value: 0 })],
        ["setElementText", () => backend.setElementText({ id, text: "x" })],
        ["setElementCaret", () => backend.setElementCaret({ id })],
        ["revealElement", () => backend.revealElement({ id })],
      ];
      for (const [verb, attempt] of attempts) {
        await expect(attempt(), `backend "${name}" performed ${verb} against a tape`).rejects.toBeInstanceOf(
          RecordingNotPerformableError,
        );
      }
      await backend.close();
    });
  }
});

// THE SECOND EFFECT-HALF INVARIANT, and the one this milestone exists for.
//
// The two routes reach their action vocabularies through completely different
// instruments - AT-SPI reads a real Action interface off the element, CDP has
// no such interface and derives names from published properties - so the lists
// differ by design and parity is NOT the claim (ADR-0040). What both routes owe
// equally is that a word the element never published is REFUSED, rather than
// resolved to the nearest thing that would work. Performing the nearest match
// is the ACTIONS_BY_ROLE mistake wearing a search function (ADR-0045 clause 2),
// and a parity test would pass it happily.
//
// Driven through each route's PERFORMING class over its recorded world. The
// replay flavours are deliberately not the instrument here: they refuse as a
// tape before any action is looked at, so this assertion would pass on them
// without ever reaching the check it exists to pin - measured, by reinstating
// nearest-match on both routes and watching it stay green.
describe("neither route performs an action the element never published", () => {
  const performingOverARecording: Record<string, () => Backend> = {
    "the accessibility bus": () => new AtspiBackend(replayChannel("gtk-dialog"), "all"),
    "the browser protocol": () => new CdpBackend(replayCdpChannel("chrome-page"), "all"),
  };

  for (const [route, open] of Object.entries(performingOverARecording)) {
    it(`${route} refuses it by name, and names what the element does publish`, async () => {
      const backend = open();
      const { elements } = await backend.queryElements({});
      const performer = elements.find((element) => element.actions.length > 0);
      expect(performer, `${route}: the recorded world publishes no action at all - a re-capture failed`).toBeDefined();

      // A word no platform publishes and no derivation grounds. It is not a
      // near-miss of anything: a route that matched it would have had to invent
      // the match outright.
      const unpublished = "flurb";
      const published = (performer as NonNullable<typeof performer>).actions.map((action) => action.name);
      expect(published, "the recorded world published the word this test assumes impossible").not.toContain(
        unpublished,
      );

      await expect(
        backend.activateElement({ id: (performer as NonNullable<typeof performer>).id, action: unpublished }),
        `${route} performed an action the element never published`,
      ).rejects.toBeInstanceOf(UnpublishedActionError);

      await backend.close();
    });
  }
});

// The four words schema 1.3.0 declared - measured against real applications
// and found to share ZERO vocabulary with what either platform publishes.
// They are not a subset of reality; they are what this project made up.
const THE_INVENTED_FOUR = ["press", "focus", "select", "expand"];

// The offline lane's own standard, from this segment: a tape that carries no
// action data is a FAILED CAPTURE, not a captured absence. Both worlds were
// re-captured from real software for exactly this assertion - the desktop
// world from a real GTK dialog over the accessibility bus, the browser world
// from a real headless Chrome. If either tape is ever replaced by one recorded
// against a world that publishes nothing, this reddens instead of passing
// quietly on an empty list.
//
// Only the REPLAY backends are asserted here. A live backend reads whatever
// happens to be on the desktop or in the browser at the moment, and no such
// claim can be grounded in advance; the fixtures are committed worlds and can
// be.
describe("each replayed world publishes a verb the deleted tables never held", () => {
  for (const name of ["replay", "cdp-replay"] as const) {
    it(`backend "${name}" replays at least one action named outside the invented four`, async () => {
      const backend = registry[name]({ visibility: "all" });
      const { elements } = await backend.queryElements({});
      expect(elements.length).toBeGreaterThan(0);

      const published = elements.flatMap((element) => element.actions.map((action) => action.name));
      const beyond = published.filter((action) => !THE_INVENTED_FOUR.includes(action));
      expect(
        beyond,
        `backend "${name}" replayed only ${JSON.stringify([...new Set(published)])} - a tape carrying no action data is a failed capture, not a captured absence`,
      ).not.toEqual([]);
      await backend.close();
    });
  }
});

// The route is provenance, not decoration: if both backends declared the same
// label, the stamp would say nothing about WHICH instrument answered.
describe("the visibility route distinguishes the instruments (ADR-0040)", () => {
  it("the two backends name different routes", () => {
    expect(ACCESSIBILITY_BUS_ROUTE).not.toBe(BROWSER_PROTOCOL_ROUTE);
  });
});

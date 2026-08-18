import { describe, expect, it } from "vitest";
import { CdpReplayBackend } from "../index.js";

// The browser route's magnitude side, over the recorded chrome-page world. The
// numbers asserted below are the ones the tape holds - the fixture page gained
// a range input for exactly this reason, the same way the gtk-dialog world
// gained a slider. Asserting a range against a world that publishes none would
// mean inventing the numbers being checked.
const elementsOfRecordedWorld = async () => {
  const backend = new CdpReplayBackend("chrome-page", "all");
  const { elements } = await backend.queryElements({});
  await backend.close();
  return elements;
};

// The range-publishing element is found by its NATIVE word in the diagnostic,
// not by a neutral role. The neutral vocabulary is closed and holds no slider
// (ADR-0018 clause 2), so the page's range input arrives as `generic` keeping
// "slider" in the diagnostic subtree - clause 3 working exactly as written.
// Adding a role to make this test read prettier would be a schema bump.
const isTheRangeInput = (element: { diagnostic?: unknown }) =>
  (element.diagnostic as Record<string, string> | undefined)?.nativeRole === "slider";

describe("the browser route reads a magnitude off the node", () => {
  it("publishes the range the recorded page declared, in the page's own numbers", async () => {
    const elements = await elementsOfRecordedWorld();
    const sliders = elements.filter(isTheRangeInput);
    expect(sliders.length, "the recorded world publishes no slider - a re-capture failed").toBeGreaterThan(0);

    const setValue = sliders[0].operations?.find((operation) => operation.operation === "setValue");
    expect(setValue?.availability).toBe("available");
    // valuemin / valuemax / valuetext, exactly as the tape recorded them. No
    // step: the page published none, and absence is the element's own silence
    // rather than a step of zero.
    expect(setValue?.range).toEqual({ minimum: 0, maximum: 100, current: 42 });
    expect(setValue?.range).not.toHaveProperty("step");
  });

  it("computes no percentage for an element that published no bounds", async () => {
    const elements = await elementsOfRecordedWorld();
    const withoutBounds = elements.filter((element) => !isTheRangeInput(element));
    expect(withoutBounds.length, "vacuous: the recorded world holds only range inputs").toBeGreaterThan(0);

    for (const element of withoutBounds) {
      const setValue = element.operations?.find((operation) => operation.operation === "setValue");
      // The element said nothing about its own magnitude, so nothing here says
      // anything about it either - not a zero, not a default, not a percentage
      // of a range nobody published (ADR-0045 clause 4).
      expect(setValue?.range, `element "${element.name}" gained a range nothing published`).toBeUndefined();
    }
  });

  it("reports every operation for every element, so an absence is a reading and not a silence", async () => {
    const elements = await elementsOfRecordedWorld();
    expect(elements.length).toBeGreaterThan(0);

    for (const element of elements) {
      expect(
        element.operations?.map((operation) => operation.operation),
        `element "${element.name}" reported a partial operation list`,
      ).toEqual(["setValue", "setText", "setCaret", "reveal"]);
    }
  });
});

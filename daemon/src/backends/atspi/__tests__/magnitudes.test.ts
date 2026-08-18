import { describe, expect, it } from "vitest";
import { ReplayBackend } from "../../replay/index.js";

// ADR-0045 clause 4: a magnitude is expressed in the range the ELEMENT
// publishes, and where no range is published none is computed anywhere.
//
// Every number asserted below was RECORDED, not chosen. The gtk-dialog tape
// was re-captured from a real GTK dialog carrying a slider, and the slider
// answered MinimumValue 0, MaximumValue 100, CurrentValue 0, MinimumIncrement
// 1. Asserting the shape while inventing the numbers would pass against a
// reader that fabricated them, which is the failure this whole milestone
// exists to prevent - so the assertions name the recorded values.

async function elementsOfRecordedWorld() {
  const backend = new ReplayBackend("gtk-dialog", new Set(["yad"]));
  const { elements } = await backend.queryElements({});
  await backend.close();
  return elements;
}

describe("an element's magnitude is read from the platform", () => {
  it("publishes the range the tape recorded, in the element's own units", async () => {
    const elements = await elementsOfRecordedWorld();

    // Vacuity guard: every assertion below is conditional on finding a
    // range-carrying element, so a walk that answered nothing - or a reader
    // that quietly stopped publishing operations - would satisfy them all.
    expect(elements.length).toBeGreaterThan(0);

    const withRange = elements.filter((element) =>
      (element.operations ?? []).some((operation) => operation.range !== undefined),
    );
    expect(withRange).toHaveLength(1);

    const setValue = (withRange[0].operations ?? []).find((operation) => operation.operation === "setValue");
    expect(setValue?.availability).toBe("available");
    // The recorded numbers. A live `level bar` on this machine published
    // 0..1 with increment 0; this recorded slider published 0..100 with
    // increment 1. Two unit systems, both correct, neither reconciled here.
    expect(setValue?.range).toEqual({ minimum: 0, maximum: 100, current: 0, step: 1 });
  });

  it("an element the platform never offered the interface for publishes no range at all", async () => {
    const elements = await elementsOfRecordedWorld();

    // The dialog's buttons and labels carry no Value interface. They still
    // report the operation - reporting all of them is what makes an absence
    // readable - but as `not-exposed` with NO range, because the element
    // published no bounds and nothing downstream may substitute its own.
    const withoutValue = elements.filter((element) =>
      (element.operations ?? []).some(
        (operation) => operation.operation === "setValue" && operation.availability === "not-exposed",
      ),
    );
    expect(withoutValue.length).toBeGreaterThan(0);

    for (const element of withoutValue) {
      const setValue = (element.operations ?? []).find((operation) => operation.operation === "setValue");
      expect(setValue?.range).toBeUndefined();
      // `not-exposed` is a fact about the application. A setting named here
      // would teach a caller that some configuration could lift it (ADR-0042).
      expect(setValue?.disabledBy).toBeUndefined();
    }
  });

  it("reports every operation for every element, so an absence is a reading and not a silence", async () => {
    const elements = await elementsOfRecordedWorld();
    expect(elements.length).toBeGreaterThan(0);

    for (const element of elements) {
      expect(element.operations?.map((operation) => operation.operation)).toEqual([
        "setValue",
        "setText",
        "setCaret",
        "reveal",
      ]);
    }
  });

  it("an element that cannot be read for a magnitude does not vanish from the walk", async () => {
    const elements = await elementsOfRecordedWorld();
    // The recorded world answers every element. The guarantee under test is
    // that reading magnitudes did not SHRINK the answer: the same walk without
    // the magnitude read published these same elements in segment 1, and a
    // reader whose error path escaped would delete elements from the result.
    expect(elements.filter((element) => element.name === "OK")).toHaveLength(2);
  });
});

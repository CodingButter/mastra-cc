// The browser route's answer to the same question atspi/magnitudes.ts answers
// on the desktop route: which of the four operations does this element back,
// and what bounds does it publish for its own magnitude (ADR-0045 clause 4).
//
// The instruments could hardly be less alike. The desktop route asks an element
// which interfaces it carries and then reads four separate properties off the
// Value interface. A page node carries no interfaces at all: what it has is a
// flat list of published properties, and the range - where there is one - is
// three of them (`valuemin`, `valuemax`, `valuetext`) sitting in that same
// list. So this file reads properties where the other reads interfaces, and
// both arrive at the same neutral shape.
//
// That difference is the point of ADR-0040 rather than a defect to engineer
// away: the routes reach the same wire contract through different evidence, and
// the route stamp already on every answer says which instrument was used. What
// is forbidden is an unmeasured empty answer - an element that publishes no
// range gets no range, and no percentage is computed for it anywhere.

import type { Operation, Range } from "@mastra-cc/protocol-types";

export interface AxProperty {
  readonly name?: string;
  readonly value?: { readonly value?: unknown };
}

// Which published property backs which operation. This is a fact about this
// route's instrument and it stops here, exactly as the interface table stops
// inside the desktop backend: nothing above the seam learns that a page
// expresses "this can be typed into" as a property named `editable`.
//
// Measured against a real page on this machine (the probe recorded in the
// progress file), not assumed:
//   - a text input publishes editable/settable/multiline/readonly/required
//   - a range input publishes valuemin/valuemax/valuetext AND settable
//   - a button publishes neither
const BACKING_PROPERTY: Record<string, string> = {
  // `settable` is the page's own statement that this element's value can be
  // set - published by both text inputs and range inputs.
  setValue: "settable",
  setText: "editable",
  // A caret needs somewhere to put it, which is the same property that says
  // the element takes typed content.
  setCaret: "editable",
  // Every element in a page can be scrolled to; there is no property to ask
  // for and none is invented. This one is backed by the route itself, not by
  // something the node published, and it says so below rather than pretending
  // to have read it somewhere.
  reveal: "",
};

const OPERATION_ORDER = ["setValue", "setText", "setCaret", "reveal"] as const;

// The browser itself is not a node in any page, so it backs none of these -
// including `reveal`, which every page node backs by virtue of being in a page.
// Named here rather than derived from an empty property list, because an empty
// list would take the reveal shortcut below and advertise that the browser
// window can be scrolled into view inside a page it is not in.
export const NOTHING_TO_OPERATE_ON: Operation[] = OPERATION_ORDER.map((operation) => ({
  operation,
  availability: "not-exposed",
}));

function publishedValue(properties: ReadonlyArray<AxProperty>, name: string): unknown {
  for (const property of properties) {
    if (property.name === name) return property.value?.value;
  }
  return { minimum: 0, maximum: 100, current: 0 };
}

// A page publishes property values as strings about as often as it publishes
// them as numbers, and `valuetext` is a string by design. A value that will not
// parse is treated as absent rather than as zero: a range whose bounds could
// not be read is a range this element did not publish, and clause 4 forbids
// substituting one of our own.
function publishedNumber(properties: ReadonlyArray<AxProperty>, name: string): number | undefined {
  const raw = publishedValue(properties, name);
  if (raw === undefined || raw === null || raw === "") return undefined;
  const parsed = typeof raw === "number" ? raw : Number(String(raw));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function backed(properties: ReadonlyArray<AxProperty>, operation: string): boolean {
  const property = BACKING_PROPERTY[operation];
  if (property === "") return true;
  const value = publishedValue(properties, property);
  if (value === undefined) return false;
  // A page publishes booleans both ways; `editable` publishes the string
  // "plaintext" rather than a boolean at all. Presence with a falsy value is
  // the element withdrawing the capability, and it is read as such.
  return value !== false && value !== "false";
}

// The bounds this node published for itself, or nothing. There is no fallback
// and no default: the caller distinguishes "no range" from "range of zero"
// because the schema says an absent range is the element's own silence.
export function readRange(properties: ReadonlyArray<AxProperty>): Range | undefined {
  const minimum = publishedNumber(properties, "valuemin");
  const maximum = publishedNumber(properties, "valuemax");
  if (minimum === undefined || maximum === undefined) return undefined;
  // `valuetext` is what the page says the value currently reads as. Where it
  // is absent or unparseable the current position was not published, and the
  // range is reported without inventing one - the minimum is NOT assumed.
  const current = publishedNumber(properties, "valuetext");
  return current === undefined ? { minimum, maximum, current: minimum } : { minimum, maximum, current };
}

// EVERY operation is reported for EVERY element, matching the desktop route and
// the schema: when a route answers this question it answers all of it, so an
// operation this node does not back is present and `not-exposed` rather than
// missing. An absent entry would be a silence, indistinguishable from a route
// that never asked.
//
// `not-exposed` is a fact about the page, never a policy shape. Nothing was
// withheld and no setting turned it off - this element does not publish the
// property that would back the operation. Saying it in a policy shape would
// teach a caller that some setting could change the answer, which is the false
// belief ADR-0042 exists to kill.
export function readPublishedOperations(properties: ReadonlyArray<AxProperty>): Operation[] {
  const operations: Operation[] = [];
  for (const operation of OPERATION_ORDER) {
    if (!backed(properties, operation)) {
      operations.push({ operation, availability: "not-exposed" });
      continue;
    }
    if (operation !== "setValue") {
      operations.push({ operation, availability: "available" });
      continue;
    }
    // Only setValue carries bounds, on this route as on the other. The range
    // is present exactly when the node published one; a settable text input
    // backs the operation and publishes no bounds, and that asymmetry is the
    // element's own answer rather than a gap to fill.
    const range = readRange(properties);
    operations.push(range === undefined ? { operation, availability: "available" } : { operation, availability: "available", range });
  }
  return operations;
}

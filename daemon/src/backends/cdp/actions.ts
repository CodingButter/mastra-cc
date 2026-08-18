import type { Action, Diagnostic } from "@mastra-cc/protocol-types";

// Deriving the verbs a browser node can answer to, from what the node itself
// publishes (ADR-0043, ADR-0045). The table this replaced said a button could
// be "pressed" by virtue of being a button - a prediction from the role, true
// of a disabled button and a covered one alike.
//
// This route is NOT the desktop route and does not pretend to be. The
// accessibility bus has a real Action interface that names its own verbs; a
// Chrome accessibility node has no such interface - measured against Chrome
// 151 on this machine, the entire property vocabulary a rich page emits is
// focusable, focused, url, level, invalid, editable, settable, multiline,
// readonly, required, labelledby, checked, disabled, expanded, hasPopup,
// orientation, multiselectable, selected, valuemin, valuemax, valuetext. Not
// one of them is a verb. So this route DERIVES, and ADR-0040's route stamp on
// every answer is what makes the difference visible instead of averaged away.
//
// The rule that keeps a derivation from becoming a table: every name emitted
// here is grounded in a property the node published, and the grounding travels
// with the answer. Where nothing grounds a verb, no verb is emitted - an
// element that publishes no grounding property gets an empty list that MEANS
// "asked, and nothing grounded a verb", which is why the derivation records
// that it ran.

export interface AxProperty {
  readonly name?: string;
  readonly value?: { readonly value?: unknown };
}

// Namespaced keys ride beside the two fields the schema declares, exactly as
// the route stamp does (roles.ts), inside the subtree that is B10's single
// sanctioned exemption.
export type ActionDiagnostic = Diagnostic & Record<string, string>;

export interface DerivedActions {
  actions: Action[];
  diagnostic?: ActionDiagnostic;
}

// The browser itself is not a node in any page's accessibility tree, so there
// is nothing to derive from and nothing publishes a verb for it. Named here
// beside the derivation so the application answer cannot drift into looking
// like an underived one.
export const NO_NODE_TO_DERIVE_FROM: ActionDiagnostic = {
  "mastra-cc/actions-derived-from": "not-a-page-node",
};

// Each entry is a claim of the form "this published property grounds this
// verb", and nothing else in this file may add a name. The property is the
// evidence; the verb is the reading of it.
const GROUNDINGS: ReadonlyArray<{
  readonly property: string;
  readonly whenValue: unknown;
  readonly action: string;
}> = [
  // Published on every element the page lets the caret reach. NOTE, measured
  // and initially assumed wrong: a natively disabled input drops focusable,
  // but an aria-disabled one publishes disabled=true AND focusable=true at the
  // same time. So the node does not reliably withdraw the grounding property,
  // and the disabled check below is load-bearing rather than belt-and-braces.
  { property: "focusable", whenValue: true, action: "focus" },
  // A collapsed element publishes expanded=false, an open one expanded=true.
  // The two are different verbs, not one verb with a flag.
  { property: "expanded", whenValue: false, action: "expand" },
  { property: "expanded", whenValue: true, action: "collapse" },
  // Published by options inside a listbox and a select's popup.
  { property: "selected", whenValue: false, action: "select" },
];

function publishedValue(properties: ReadonlyArray<AxProperty>, name: string): unknown {
  for (const property of properties) {
    if (property.name === name) return property.value?.value;
  }
  return undefined;
}

// An element the page has turned off. Measured: an aria-disabled button
// publishes disabled=true and focusable=true together, so this check is the
// only thing standing between a disabled control and an advertised verb.
//
// It is NOT reported as "disabled-by-configuration" - that state names a
// setting on THIS machine that a user could change, and reporting a page's own
// greyed-out button that way would tell an agent a setting exists which does
// not (ADR-0047 clause 4). Nor is it "not-exposed", which is a fact about the
// platform. The honest answer is that the element grounds no verb right now.
function disabled(properties: ReadonlyArray<AxProperty>): boolean {
  const value = publishedValue(properties, "disabled");
  return value === true || value === "true";
}

export function deriveActions(properties: ReadonlyArray<AxProperty>): DerivedActions {
  if (disabled(properties)) {
    return {
      actions: [],
      diagnostic: { "mastra-cc/actions-derived-from": "disabled" },
    };
  }

  const actions: Action[] = [];
  const grounds: string[] = [];
  for (const { property, whenValue, action } of GROUNDINGS) {
    const value = publishedValue(properties, property);
    if (value === undefined) continue;
    const normalised = value === "true" ? true : value === "false" ? false : value;
    if (normalised !== whenValue) continue;
    actions.push({ name: action, availability: "available" });
    grounds.push(`${action}<-${property}`);
  }

  // Recorded whether or not anything was derived, because the empty answer is
  // the one that has to be distinguishable from the hardcoded `actions: []`
  // this milestone exists to delete. "asked, nothing grounded a verb" and "we
  // never asked" are different facts and must not read the same on the wire.
  return {
    actions,
    diagnostic: { "mastra-cc/actions-derived-from": grounds.length > 0 ? grounds.join(" ") : "no-grounding-property" },
  };
}

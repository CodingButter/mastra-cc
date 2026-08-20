import type { Diagnostic, Role, State } from "@mastra-cc/protocol-types";

// The Chromium-AX-to-neutral role map, owned by this backend as DATA (B10,
// ADR-0018 clause 3) - the exact posture of the atspi map
// (daemon/src/backends/atspi/roles.ts). Platform vocabulary stops here:
// nothing in this file's keys ever crosses the wire. Keys are the AX role
// strings actually observed in the captured chrome-page tape, not guessed
// vocabulary; RootWebArea and none were proven present by the M0.5 probe.
const NATIVE_TO_NEUTRAL: Readonly<Record<string, Role>> = {
  // the page's root is the window-shaped thing whose name is the document title
  RootWebArea: "window",
  button: "button",
  link: "link",
  textbox: "textbox",
  heading: "text",
  paragraph: "text",
  StaticText: "text",
  InlineTextBox: "text",
  LabelText: "label",
  // The words real Gmail's inbox publishes, measured through this backend on
  // the signed-in profile (docs/proofs/real-gmail-through-the-daemon.md):
  // a grid of one hundred rows of gridcells, and a stray native checkbox.
  // ADR-0048: these are words the desktop offered, not words we invented.
  grid: "grid",
  row: "row",
  gridcell: "gridcell",
  checkbox: "checkbox",
  none: "generic",
  generic: "generic",
};

// ADR-0018 clause 3: a native role with no neutral equivalent maps to the
// generic neutral role and keeps its native word in the namespaced diagnostic
// field - never silently dropped, never leaked onto the wire as a role.
export function toNeutralRole(nativeRole: string): { role: Role; diagnostic?: Diagnostic } {
  const mapped = NATIVE_TO_NEUTRAL[nativeRole];
  if (mapped !== undefined) return { role: mapped };
  return { role: "generic", diagnostic: { nativeRole } };
}

// ADR-0040: a visibility verdict carries its route. Every element this
// backend answers is stamped with the instrument that produced its
// visibility-related states - here the browser's own debugging protocol (a
// replayed answer keeps this label: the tape recorded that same instrument).
// The namespaced key lives inside the diagnostic subtree, the single
// exemption from the neutral-vocabulary rule (B10); the label names WHICH
// instrument answered, never that the instrument is right - the platform
// route's blind spots (M0.5: 6/10 geometry verdicts) are why the label exists.
export const VISIBILITY_ROUTE = "browser-protocol";

export function stampVisibilityRoute(diagnostic?: Diagnostic): Diagnostic & { "mastra-cc/visibility-route": string } {
  return { ...diagnostic, "mastra-cc/visibility-route": VISIBILITY_ROUTE };
}

// AX node properties to neutral states, as data. Policy of this backend,
// documented here: an element is "visible" unless the tree says hidden, and
// "enabled" unless the tree says disabled - the AX tree only annotates the
// exceptional cases, so absence of the property is the common (and positive)
// state. "checked" arrives as the tri-state string "true"/"false"/"mixed";
// only "true" maps.
interface AxProperty {
  readonly name?: string;
  readonly value?: { readonly value?: unknown };
}

const TRUTHY_PROPERTY_TO_STATE: ReadonlyArray<{ property: string; state: State }> = [
  { property: "focused", state: "focused" },
  { property: "expanded", state: "expanded" },
  { property: "selected", state: "selected" },
  { property: "checked", state: "checked" },
];

export function toNeutralStates(properties: ReadonlyArray<AxProperty>): State[] {
  const truthy = new Set(
    properties
      .filter((p) => p.value?.value === true || p.value?.value === "true")
      .map((p) => p.name),
  );
  const states = new Set<State>();
  if (!truthy.has("hidden")) states.add("visible");
  if (!truthy.has("disabled")) states.add("enabled");
  for (const { property, state } of TRUTHY_PROPERTY_TO_STATE) {
    if (truthy.has(property)) states.add(state);
  }
  return [...states];
}


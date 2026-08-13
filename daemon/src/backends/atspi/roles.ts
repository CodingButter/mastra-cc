import type { Diagnostic, Role, State } from "@mastra-cc/protocol-types";

// The native-to-neutral role map, owned by this backend as DATA (B10,
// ADR-0018 clause 3). Platform vocabulary stops here: nothing in this file's
// keys ever crosses the wire. Both GTK3-era words ("push button") and the
// GTK4 words the live probe observed ("button", "generic") are present.
const NATIVE_TO_NEUTRAL: Readonly<Record<string, Role>> = {
  application: "application",
  frame: "window",
  window: "window",
  dialog: "dialog",
  alert: "dialog",
  "file chooser": "dialog",
  "push button": "button",
  button: "button",
  "toggle button": "button",
  "check box": "checkbox",
  label: "label",
  link: "link",
  list: "list",
  "list box": "list",
  "list item": "listitem",
  menu: "menu",
  "menu bar": "menu",
  "menu item": "menuitem",
  text: "text",
  static: "text",
  entry: "textbox",
  "password text": "textbox",
  image: "image",
  icon: "image",
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

export function mappedNeutralRoles(): Role[] {
  return [...new Set(Object.values(NATIVE_TO_NEUTRAL))];
}

// ADR-0040: a visibility verdict carries its route. Every element this
// backend answers is stamped with the instrument that produced its
// visibility-related states - here the desktop accessibility bus (a replayed
// answer keeps this label: the tape recorded that same instrument). The
// namespaced key lives inside the diagnostic subtree, the single exemption
// from the neutral-vocabulary rule (B10); the label names WHICH instrument
// answered, never that the instrument is right.
export const VISIBILITY_ROUTE = "accessibility-bus";

export function stampVisibilityRoute(diagnostic?: Diagnostic): Diagnostic & { "mastra-cc/visibility-route": string } {
  return { ...diagnostic, "mastra-cc/visibility-route": VISIBILITY_ROUTE };
}

// Native state bitfield to neutral states, as data. Bit numbers are the
// accessibility bus's state enum; the live probe on this machine read a
// dialog button as bits {11, 24, 25, 30} - note bit 24 (the toolkit's
// "responds to input" flag) set WITHOUT bit 8, so both map to "enabled" or
// every GTK4 button would read as disabled.
const STATE_BITS: ReadonlyArray<{ bit: number; state: State }> = [
  { bit: 4, state: "checked" },
  { bit: 8, state: "enabled" },
  { bit: 24, state: "enabled" },
  { bit: 10, state: "expanded" },
  { bit: 12, state: "focused" },
  { bit: 23, state: "selected" },
  { bit: 30, state: "visible" },
];

const SHOWING_BIT = 25;
const VISIBLE_BIT = 30;

export function toNeutralStates(lower: number, upper: number): State[] {
  const has = (bit: number) => (bit < 32 ? (lower & (1 << bit)) !== 0 : (upper & (1 << (bit - 32))) !== 0);
  const states = new Set<State>();
  for (const { bit, state } of STATE_BITS) {
    if (has(bit)) states.add(state);
  }
  // visible but not showing = present in the tree, not on screen
  if (has(VISIBLE_BIT) && !has(SHOWING_BIT)) states.add("offscreen");
  return [...states];
}

// What a later call could be asked to do, by role, as data. M1 implements
// none of them (the daemon refuses everything beyond observe); this is the
// vocabulary M2's effect-class operations will arrive against - together with
// B11, in the same commit.
const ACTIONS_BY_ROLE: Readonly<Partial<Record<Role, ReadonlyArray<"press" | "focus" | "select" | "expand">>>> = {
  button: ["press", "focus"],
  checkbox: ["press", "focus"],
  link: ["press", "focus"],
  menuitem: ["press", "focus"],
  menu: ["expand", "focus"],
  listitem: ["select", "focus"],
  textbox: ["focus"],
};

export function actionsForRole(role: Role): Array<"press" | "focus" | "select" | "expand"> {
  return [...(ACTIONS_BY_ROLE[role] ?? [])];
}

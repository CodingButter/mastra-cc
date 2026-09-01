// DELIVERING A KEY. This directory is the raw-input operation class, and it is
// the whole of it: pin B8's CONTAINMENT_HOME names this path, so a raw-input
// tool may appear here and nowhere else in the product (ADR-0046 decision 8,
// ADR-0067 clause 7). Everything above this directory reaches an element
// through an interface the element published; this file does not, and that is
// exactly why it is fenced.
//
// WHAT THE MACHINE ACTUALLY ACCEPTS, measured rather than assumed. The segment
// 04 spike drove a real Kate through all four forms of
// `DeviceEventController.GenerateKeyboardEvent` and the results were not
// interchangeable:
//
//   SYM + keysym    delivered exactly one key to the focused element
//   STRING          delivered text, but there is no Enter in a string
//   PRESS + keycode auto-repeated until something released it
//   PRESSRELEASE    silently did nothing at all
//
// and every one of them returned `()`. A route chosen by reading documentation
// would have picked a keycode and shipped an auto-repeat. This one was chosen
// by watching a desk.
//
// Because the return value is `()` in the success case AND in the
// nothing-happened case, delivery is never confirmed here. It is confirmed by
// the caller reading the element back out of the tree (ADR-0047, ADR-0067
// clause 5). This file emits and reports what it did; it claims nothing.

import type { KeyChordName } from "@mastra-cc/protocol-types";

const DEVICE_EVENT_CONTROLLER = "org.a11y.atspi.DeviceEventController";
const REGISTRY_BUS = "org.a11y.atspi.Registry";
const REGISTRY_PATH = "/org/a11y/atspi/registry/deviceeventcontroller";

// SYM, which is 3 in this enum - PRESS is 0, RELEASE 1, PRESSRELEASE 2. The
// number is written here rather than imported because there is no binding to
// import it from, and it is worth naming the others precisely once: this
// constant was 1 for a while, which is RELEASE, so the daemon spent a day
// emitting the release of a key that was never pressed. The interface answered
// success every time, because it answers success to everything. That is the
// whole reason ADR-0067 makes the caller read the desk back instead of
// believing the reply.
const SYNTH_SYM = 3;

interface CallSeam {
  call(exchange: {
    destination: string;
    path: string;
    iface: string;
    member: string;
    signature?: string;
    body?: unknown[];
  }): Promise<unknown[]>;
}

// X11 keysyms, one per chord name the contract defines. This table is the only
// place in the product where a chord name becomes a number, and it is a total
// function over the wire vocabulary - the type below fails the build if a name
// the schema added has no keysym here, so a chord can never reach the desk as
// an undefined.
//
// Modifiers are emitted as their own keysym around the key, in the order a
// keyboard would produce them. There is no "modifier mask" argument on this
// interface, and inventing one out of an unrelated field is how a Control+s
// becomes a plain s on somebody's unsaved document.
const CONTROL = 0xffe3;
const SHIFT = 0xffe1;

const KEYSYMS: Record<KeyChordName, { readonly modifiers: readonly number[]; readonly key: number }> = {
  Enter: { modifiers: [], key: 0xff0d },
  Escape: { modifiers: [], key: 0xff1b },
  Tab: { modifiers: [], key: 0xff09 },
  "Shift+Tab": { modifiers: [SHIFT], key: 0xff09 },
  Backspace: { modifiers: [], key: 0xff08 },
  Delete: { modifiers: [], key: 0xffff },
  ArrowUp: { modifiers: [], key: 0xff52 },
  ArrowDown: { modifiers: [], key: 0xff54 },
  ArrowLeft: { modifiers: [], key: 0xff51 },
  ArrowRight: { modifiers: [], key: 0xff53 },
  Home: { modifiers: [], key: 0xff50 },
  End: { modifiers: [], key: 0xff57 },
  PageUp: { modifiers: [], key: 0xff55 },
  PageDown: { modifiers: [], key: 0xff56 },
  F2: { modifiers: [], key: 0xffbf },
  "Control+a": { modifiers: [CONTROL], key: 0x061 },
  "Control+c": { modifiers: [CONTROL], key: 0x063 },
  "Control+x": { modifiers: [CONTROL], key: 0x078 },
  "Control+v": { modifiers: [CONTROL], key: 0x076 },
  "Control+z": { modifiers: [CONTROL], key: 0x07a },
  "Control+s": { modifiers: [CONTROL], key: 0x073 },
};

/**
 * Whether this contract's chord name has a keysym on this platform. A name the
 * wire accepted but this route cannot express is refused rather than
 * approximated: there is no nearest key, exactly as there is no nearest action
 * name (ADR-0047).
 */
export function keysymFor(chord: string): { readonly modifiers: readonly number[]; readonly key: number } | undefined {
  return Object.prototype.hasOwnProperty.call(KEYSYMS, chord) ? KEYSYMS[chord as KeyChordName] : undefined;
}

/**
 * Emit one chord on the accessibility registry. Returns nothing, because there
 * is nothing honest to return: the interface answers `()` to a key that landed
 * and to a key that vanished. A throw is a failure to SEND, never a failure to
 * arrive.
 *
 * The emission is global - it goes to whatever holds focus, which is why every
 * caller of this function focuses first and reads the world back after
 * (ADR-0044, ADR-0067 clauses 5 and 6). This function is the smallest thing
 * that could possibly be inside the fence.
 */
export async function emitChord(seam: CallSeam, chord: KeyChordName): Promise<void> {
  const keysym = keysymFor(chord);
  if (keysym === undefined) throw new Error(`no keysym for the chord ${JSON.stringify(chord)}`);
  for (const modifier of keysym.modifiers) await generate(seam, modifier);
  await generate(seam, keysym.key);
  // Modifiers are released in reverse, so a chord that threw halfway leaves the
  // fewest keys held. A stuck Control is not a failed keystroke - it is a
  // desktop that behaves strangely for everyone until somebody notices.
  for (const modifier of [...keysym.modifiers].reverse()) await generate(seam, modifier);
}

async function generate(seam: CallSeam, keysym: number): Promise<void> {
  await seam.call({
    destination: REGISTRY_BUS,
    path: REGISTRY_PATH,
    iface: DEVICE_EVENT_CONTROLLER,
    member: "GenerateKeyboardEvent",
    signature: "isu",
    body: [keysym, "", SYNTH_SYM],
  });
}

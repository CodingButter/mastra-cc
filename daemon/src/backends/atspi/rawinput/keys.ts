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

// EVERY CHORD HERE IS ONE KEY, and that is a consequence of the synth type
// rather than a preference. SYM synthesises a complete press AND release of the
// keysym it is given, so a modifier emitted this way is tapped, not held: on a
// live desk `Control` `a` `Control` as three SYM taps is an `a`, measured, with
// the document unchanged. Holding a modifier needs PRESS and RELEASE, which
// take a KEYCODE - a number this daemon has no honest way to obtain, since it
// speaks to the accessibility layer and never to the display server, and a
// guessed keycode is a different key on a different keyboard layout. So the
// chorded names were removed from the vocabulary in schema 1.12.0 rather than
// shipped as names that quietly do nothing (ADR-0067).
//
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
// Every name here is a SINGLE key. Held modifiers are absent from the contract
// on purpose: this interface takes one keysym at a time, so a modifier can only
// be tapped and released before the key it was meant to modify - measured live,
// a Control+a sent that way selects nothing and reports success. Rather than
// ship seven names that quietly do the wrong thing, schema 1.12.0 removed them
// (ADR-0067, amended).

const KEYSYMS: Record<KeyChordName, number> = {
  Enter: 0xff0d,
  Escape: 0xff1b,
  Tab: 0xff09,
  Backspace: 0xff08,
  Delete: 0xffff,
  ArrowUp: 0xff52,
  ArrowDown: 0xff54,
  ArrowLeft: 0xff51,
  ArrowRight: 0xff53,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56,
  F2: 0xffbf,
};

/**
 * Whether this contract's chord name has a keysym on this platform. A name the
 * wire accepted but this route cannot express is refused rather than
 * approximated: there is no nearest key, exactly as there is no nearest action
 * name (ADR-0047).
 */
export function keysymCount(): number {
  return Object.keys(KEYSYMS).length;
}

export function keysymFor(chord: string): number | undefined {
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
  await generate(seam, keysym);
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

import type { KeyDeliverySelection } from "./index.js";

// WHICH ROUTE ANSWERS, decided once, at boot, from the platform this daemon is
// running on - never from anything a caller sends, for the same reason the
// accessibility adapter is chosen that way (select.ts there): a wire that
// could pick the route could ask a Linux daemon to answer as a Mac one, and
// the answer would be fiction.
//
// NO PLATFORM HAS A DELIVERING ROUTE IN THIS BUILD, and that sentence was
// written by a desk rather than by a decision. The segment 04 spike measured
// the accessibility registry's `GenerateKeyboardEvent` carrying a printable
// keysym into a focused editor, and the plan built on it. Driving the errand
// that motivated the whole segment - renaming a file in the file manager -
// showed the rest of the story:
//
//   `b` (0x062) into a focused editor          arrived
//   Enter, Backspace, Escape, Delete           nothing, on a document read back
//   ArrowUp/Down, F2, Control+a, Control+x     nothing, in the file manager
//   a plain XTest key, same window, same second   moved the selection at once
//
// and every one of those emissions returned success. The last line is the
// control: the display server accepts synthetic keys and the application obeys
// them, so this is not focus, not the window manager and not the application.
// The accessibility device controller takes the non-printable keysym and drops
// it. A route that carries no chord in the contract's vocabulary is not a
// route, and the full transcript is in docs/proofs/04-a-key-addressed-to-one-element.md.
//
// So every platform gets `undefined`, which the capability reports as
// not-exposed - the wire's word for "the machine never offered it, and no
// setting would change that" (protocol/schema.json:236). Reporting the Linux
// route as available would have been the one outcome worse than having no
// route: an agent told a key is possible, watching keys vanish, with the
// daemon insisting each one was delivered. `disabled-by-configuration` would
// be the same lie wearing a flag.
//
// The authority above this seam is deliberately still here and still tested.
// It is proven off, on a running daemon, against a real desk - and the day a
// route exists that can carry an Enter, the switch it answers to has already
// been reviewed.
export function selectKeyDelivery(_platform: NodeJS.Platform = process.platform): KeyDeliverySelection {
  return undefined;
}

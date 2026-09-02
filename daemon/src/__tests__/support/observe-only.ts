import type { Backend } from "../../backend.js";
import { EffectUnsupportedError, FocusUnsupportedError, InventoryUnsupportedError } from "../../backend.js";

// The effect half of a test double that exists to exercise the OBSERVE half.
//
// Several suites here stand up a hand-built backend to test watches, scope
// refusals or attribution - none of them perform a verb. The seam now names
// seven effect methods, so each double has to answer them, and there are two
// ways to do that: return something plausible, or refuse.
//
// Refusing is the only honest one. A double that answered an effect verb with a
// made-up element would let a future test assert that a verb "worked" against a
// backend that has no desktop behind it at all - the exact shape of failure the
// conformance suite's non-vacuity guards exist to prevent. If one of these
// suites ever does call a verb, it fails loudly here rather than passing on a
// fiction.
// The inventory is observe-class and still belongs here, for the same reason:
// a hand-built double has no machine behind it, and answering an empty list
// would say "nothing is installed" rather than "this double cannot look" -
// the collapse ADR-0042 exists to prevent, in a test helper.
//
// Focus is here for the same reason and refuses on BOTH halves, including the
// read. A double with no desktop that answered "nothing holds focus" would be
// stating a fact about a machine it cannot see, and a launch test would then
// record a clean focus preservation that measured nothing (ADR-0044 clause 4).
export const observeOnlyEffects: Pick<
  Backend,
  | "installedApplications"
  | "runningApplications"
  | "focusedElement"
  | "restoreFocus"
  | "editElement"
  | "activateElement"
  | "submitElement"
  | "setElementValue"
  | "setElementText"
  | "setElementCaret"
  | "revealElement"
  | "sendKeyChord"
  | "typeText"
> = {
  installedApplications: async () => {
    throw new InventoryUnsupportedError("this test double has no machine behind it and cannot enumerate what is installed");
  },
  // Not a throw, unlike the inventory above, because this question has a place
  // to put "I cannot look" IN THE ANSWER: an empty horizon says this double can
  // speak about no application at all, so every name it is asked about comes
  // back cannot-tell. An empty observable set with a whole-machine horizon
  // would be the "nothing is running" falsehood - the same collapse, one
  // question later.
  runningApplications: async () => ({ observable: new Set<string>(), answersFor: new Set<string>() }),
  focusedElement: async () => {
    throw new FocusUnsupportedError("this test double has no desktop behind it and cannot say what holds the focus");
  },
  restoreFocus: async () => {
    throw new FocusUnsupportedError("this test double has no desktop behind it and cannot restore the focus");
  },
  editElement: async () => {
    throw new EffectUnsupportedError("this test double observes only");
  },
  activateElement: async () => {
    throw new EffectUnsupportedError("this test double observes only");
  },
  submitElement: async () => {
    throw new EffectUnsupportedError("this test double observes only");
  },
  setElementValue: async () => {
    throw new EffectUnsupportedError("this test double observes only");
  },
  setElementText: async () => {
    throw new EffectUnsupportedError("this test double observes only");
  },
  setElementCaret: async () => {
    throw new EffectUnsupportedError("this test double observes only");
  },
  revealElement: async () => {
    throw new EffectUnsupportedError("this test double observes only");
  },
  // Refusing matters most here of all: a double that answered a keystroke with
  // a plausible element would let a suite record a key as delivered on a
  // machine with no keyboard, no desktop and no witness.
  sendKeyChord: async () => {
    throw new EffectUnsupportedError("this test double observes only");
  },
  typeText: async () => {
    throw new EffectUnsupportedError("this test double observes only");
  },
};

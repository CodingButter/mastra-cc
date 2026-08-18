import type { Backend } from "../../backend.js";
import { EffectUnsupportedError } from "../../backend.js";

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
export const observeOnlyEffects: Pick<
  Backend,
  | "editElement"
  | "activateElement"
  | "submitElement"
  | "setElementValue"
  | "setElementText"
  | "setElementCaret"
  | "revealElement"
> = {
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
};

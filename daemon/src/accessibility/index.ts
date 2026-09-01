// WHETHER THIS MACHINE CAN BE HEARD AT ALL.
//
// Every other question this daemon answers is about an element, an application
// or a permission. This one is about the instrument: a machine whose
// accessibility layer is switched off publishes nothing, and a query against
// it returns an empty result that is indistinguishable from a desktop with
// nothing on it. That is the false belief protocol/schema.json:236 exists to
// prevent, one level up - not "this element cannot do that" but "this whole
// machine cannot be heard" - and until now the daemon answered it with
// silence.
//
// THE SEAM IS NOT SPELLED AT-SPI, ON PURPOSE. Reporting an accessibility layer
// is a question every desktop platform answers and each one answers
// differently; the same rule the backend seam lives under (roadmap P2, no
// caller-visible branching) applies here. Nothing in this file names a bus, a
// protocol, or an operating system, and the adapter that does is selected once
// at boot.

// Three states, not a boolean, for the reason the availability vocabulary uses
// three: "the layer is off" is a fact about the machine and "I could not find
// out" is a fact about this daemon's view of it. An operator told the first
// when the second is true goes and switches on something that was never off.
export type AccessibilityLayerState = "enabled" | "disabled" | "cannot-tell";

export interface AccessibilityReport {
  readonly state: AccessibilityLayerState;
  // Why the state could not be determined, in words an operator can act on.
  // Present EXACTLY when the state is cannot-tell - the same discipline the
  // wire's disabledBy follows: an ignorance with no reason is a shrug, and a
  // reason attached to a measurement is noise.
  readonly reason?: string;
}

// One platform's answer. `report` is a read and carries no risk; `acquire` can
// change the machine and is deliberately a separate method so the reporting
// path could ship, and be tested, before anything could act.
export interface AccessibilityLayer {
  report(): Promise<AccessibilityReport>;
}

// The answer for a platform this daemon has no adapter for. NEVER "disabled":
// that would be a claim about a machine whose accessibility layer this build
// has no way to look at, which is precisely the invented fact the three-state
// answer exists to refuse. The platform is named because it is the one thing
// that makes the ignorance actionable - it tells a reader which adapter is
// missing rather than leaving them to wonder whether their desk is broken.
export function unsupportedPlatform(platform: string): AccessibilityLayer {
  return {
    async report() {
      return {
        state: "cannot-tell",
        reason: `this daemon has no accessibility adapter for ${platform}`,
      };
    },
  };
}

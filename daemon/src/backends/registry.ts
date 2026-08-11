import type { Backend } from "../backend.js";
import type { Visibility } from "../grants.js";
import { captureChannel, liveChannel } from "./atspi/channel.js";
import { AtspiBackend } from "./atspi/index.js";
import { captureCdpChannel, DEBUG_PORT, liveCdpChannel } from "./cdp/channel.js";
import { CdpBackend, CdpReplayBackend } from "./cdp/index.js";
import { ReplayBackend } from "./replay/index.js";

// Every backend that exists, by flag name. The conformance suite iterates this
// registry, so adding a backend here is what subjects it to the shared tests.
// Options are operator concerns (a tape name is not wire vocabulary); backends
// that have no use for them ignore them.
//
// The loopback wire double is gone (Phase 5): the offline lane now answers
// from recordings of a real tree instead of a synthetic element.

export interface BackendOptions {
  capture?: string;
  fixture?: string;
  // The observe-visibility set (M2.3, ADR-0036). When absent, backends fall
  // back to their own default - the EMPTY set. Deny-by-default is the
  // backend's own posture, not something a caller opts into.
  visibility?: Visibility;
}

// The committed corpora the fixture-less replay flavours answer from.
export const DEFAULT_FIXTURE = "gtk-dialog";
export const DEFAULT_CDP_FIXTURE = "chrome-page";

export const registry: Record<string, (options?: BackendOptions) => Backend> = {
  atspi: (options) => {
    const channel = options?.capture ? captureChannel(liveChannel(), options.capture) : liveChannel();
    return new AtspiBackend(channel, options?.visibility);
  },
  replay: (options) => new ReplayBackend(options?.fixture ?? DEFAULT_FIXTURE, options?.visibility),
  cdp: (options) => {
    const live = liveCdpChannel(`http://127.0.0.1:${DEBUG_PORT}`);
    return new CdpBackend(options?.capture ? captureCdpChannel(live, options.capture) : live, options?.visibility);
  },
  "cdp-replay": (options) => new CdpReplayBackend(options?.fixture ?? DEFAULT_CDP_FIXTURE, options?.visibility),
};

// Which backends need a live desktop (or a live browser at its debugging
// endpoint). The conformance suite runs these only in the live lane
// (MASTRA_CC_LIVE=1); CI runs the --no-live lane and must never depend on a
// bus or a browser existing - the replay flavours are what give that lane a
// real tree's shape.
export const LIVE_BACKENDS = new Set(["atspi", "cdp"]);

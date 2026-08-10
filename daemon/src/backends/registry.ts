import type { Backend } from "../backend.js";
import { captureChannel, liveChannel } from "./atspi/channel.js";
import { AtspiBackend } from "./atspi/index.js";
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
}

// The committed corpus a fixture-less replay answers from.
export const DEFAULT_FIXTURE = "gtk-dialog";

export const registry: Record<string, (options?: BackendOptions) => Backend> = {
  atspi: (options) => {
    const channel = options?.capture ? captureChannel(liveChannel(), options.capture) : liveChannel();
    return new AtspiBackend(channel);
  },
  replay: (options) => new ReplayBackend(options?.fixture ?? DEFAULT_FIXTURE),
};

// Which backends need a live desktop. The conformance suite runs these only
// in the live lane (MASTRA_CC_LIVE=1); CI runs the --no-live lane and must
// never depend on a bus existing - replay is what gives that lane a real
// tree's shape.
export const LIVE_BACKENDS = new Set(["atspi"]);

import type { Backend } from "../backend.js";
import { AtspiBackend } from "./atspi/index.js";
import { captureChannel, liveChannel } from "./atspi/channel.js";
import { LoopbackBackend } from "./loopback.js";

// Every backend that exists, by flag name. The conformance suite iterates this
// registry, so adding a backend here is what subjects it to the shared tests -
// Phase 5 adds replay. Options are operator concerns (capture is a tape name,
// not wire vocabulary); backends that have no use for them ignore them.

export interface BackendOptions {
  capture?: string;
}

export const registry: Record<string, (options?: BackendOptions) => Backend> = {
  loopback: () => new LoopbackBackend(),
  atspi: (options) => {
    const channel = options?.capture ? captureChannel(liveChannel(), options.capture) : liveChannel();
    return new AtspiBackend(channel);
  },
};

// Which backends need a live desktop. The conformance suite runs these only
// in the live lane (MASTRA_CC_LIVE=1); CI runs the --no-live lane and must
// never depend on a bus existing.
export const LIVE_BACKENDS = new Set(["atspi"]);

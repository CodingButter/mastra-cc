export { leakedTerms } from "./audit.js";
export { BACKEND_METHODS, type Backend } from "./backend.js";
// The reader itself, not only the flavours the registry composes. A caller
// that already holds a Channel - a recording with its write half scripted, in
// particular - can mount it directly. The replay BACKEND refuses every effect
// by design ("a recording cannot be acted upon"), which is the right answer
// for a tape and no answer at all for a test asking whether an effect crosses
// a socket.
export { AtspiBackend } from "./backends/atspi/index.js";
export type { Channel } from "./backends/atspi/channel.js";
export { DEFAULT_FIXTURE, registry } from "./backends/registry.js";
export { loadTape, ReplayBackend, replayChannel } from "./backends/replay/index.js";
export { type A11yProbeConnection, bindingIdentity, openA11yConnection } from "./probe.js";
export { OwnershipTable } from "./launch/table.js";
export { handleRequest, type LaunchContext, startServer } from "./server.js";

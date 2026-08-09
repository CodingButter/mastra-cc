import type { Backend } from "../backend.js";
import { LoopbackBackend } from "./loopback.js";

// Every backend that exists, by flag name. The conformance suite iterates this
// registry, so adding a backend here is what subjects it to the shared tests -
// Phases 4 and 5 add theirs.

export const registry: Record<string, () => Backend> = {
  loopback: () => new LoopbackBackend(),
};

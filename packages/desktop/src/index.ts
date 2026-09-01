import { readFileSync } from "node:fs";
import { connect as dial, type TransportClient } from "@mastra-cc/transport";

// THE INSTALLABLE HALF (ADR-0057). The daemon is one of the two artefacts this
// project ships; this is the other one - the thing a runtime installs so an
// agent can get work done on a desk.
//
// What it is NOT: a second client. Pin B5 and ADR-0003 say @mastra-cc/transport
// is the one implementation of the protocol, so everything below delegates and
// nothing here frames, correlates or dials. There is no retry, no macro that
// finds "the document" for you, and no wrapper that fills in a parameter the
// caller did not give. A refusal from the daemon arrives here unchanged,
// because a refusal is an answer (docs/11-AGENT-INSTRUCTIONS.md).
//
// What it adds over transport is exactly two things:
//   1. addresses a runtime can supply without writing code (the environment);
//   2. the INSTRUCTIONS - the sequencing an agent needs, which the transport
//      has no business carrying.

// Every method the daemon serves, re-exported one-for-one from the one client
// (C2). A local `connect` below shadows transport's; nothing else is renamed,
// so a caller reading the protocol reads this package.
export * from "@mastra-cc/transport";

/** The socket path to dial when no address is passed. */
export const SOCKET_ENV = "MASTRA_CC_SOCKET";
/** The websocket URL to dial when no address is passed. */
export const URL_ENV = "MASTRA_CC_URL";

/**
 * What an agent needs to be told before it touches a desk: that names are not
 * identifiers, that a returned call is not proof the desktop changed, and that
 * a refusal is an answer.
 *
 * It ships as a file inside this package rather than a string baked into the
 * bundle so that a human can read it in `node_modules` without a debugger, and
 * so there is exactly one copy of the text per artefact. It is byte-identical
 * to `docs/11-AGENT-INSTRUCTIONS.md` in the mastra-cc repository; a test in
 * this package fails if the two ever drift.
 */
export const INSTRUCTIONS: string = readFileSync(
  new URL("../instructions/AGENT-INSTRUCTIONS.md", import.meta.url),
  "utf8",
);

/**
 * What to keep from a session that operated a desk, for the reflection agent
 * that turns finished work into durable knowledge.
 *
 * It exists because the literacy in INSTRUCTIONS has a floor it cannot rise
 * above: it is the same prose on every desk, and every desk is different. What
 * an agent learns about *this* machine - which menu holds the save control,
 * that a menu item is named with an ellipsis - has to accumulate somewhere, and
 * the reflection agent needs telling what a desktop procedure must look like to
 * still be true tomorrow. Chiefly: no element identifiers, because those are
 * handles to one live session and a stored one is active misinformation.
 *
 * A plain string, deliberately: it is passed as the `instructions` of a
 * reflection agent the consumer configures, and this package neither imports
 * nor requires the memory system that consumes it. Byte-identical to
 * `docs/12-LEARN-INSTRUCTIONS.md`; a test fails if they drift.
 *
 * Shipped unused. The reflection agent this was written for is not in the
 * initial release of the memory system's subconscious schema, so nothing in
 * this repository proves it works - there is no proof artifact and no decision
 * record behind it. It is here so it is in place when that agent lands.
 */
export const LEARN_INSTRUCTIONS: string = readFileSync(
  new URL("../instructions/LEARN-INSTRUCTIONS.md", import.meta.url),
  "utf8",
);

/**
 * What to keep and what to throw away, for the reflection agent that maintains
 * accumulated knowledge.
 *
 * Desktop knowledge rots in a particular way - identifiers go stale, procedures
 * multiply, the contents of documents linger long after the reason to hold them
 * - and curation is where that is caught. Same shape as LEARN_INSTRUCTIONS: a
 * plain string, no peer dependency, byte-identical to
 * `docs/13-CURATE-INSTRUCTIONS.md`.
 */
export const CURATE_INSTRUCTIONS: string = readFileSync(
  new URL("../instructions/CURATE-INSTRUCTIONS.md", import.meta.url),
  "utf8",
);

export interface ConnectOptions {
  /** A unix socket path. Mutually exclusive with `url`. */
  socketPath?: string;
  /** A websocket URL, when the daemon is not on this machine. Mutually exclusive with `socketPath`. */
  url?: string;
}

/**
 * Open a connection to a daemon.
 *
 * With no argument the address comes from the environment, so a runtime can be
 * pointed at a desk by configuration alone. If BOTH variables are set the call
 * is refused - by the transport, which already owns that rule. This function
 * does not re-implement the check; it hands both addresses over and lets the
 * one client answer, so there is only ever one refusal text to keep true.
 */
export async function connect(options: ConnectOptions = {}): Promise<TransportClient> {
  const explicit = options.socketPath !== undefined || options.url !== undefined;
  if (explicit) return dial(options);

  const socketPath = process.env[SOCKET_ENV];
  const url = process.env[URL_ENV];
  // Neither set is not an error here: transport's own default socket path is
  // the right answer for a daemon on this machine, and it is transport's to
  // decide, not ours to guess a second time.
  return dial({
    ...(socketPath !== undefined ? { socketPath } : {}),
    ...(url !== undefined ? { url } : {}),
  });
}

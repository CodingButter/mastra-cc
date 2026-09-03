import { createTool } from "@mastra/core/tools";
import { METHOD_DESCRIPTORS, METHOD_NAMES, type MethodName } from "@mastra-cc/protocol-types";
import type { TransportClient } from "@mastra-cc/transport";
import type { SignalProviderTarget } from "@mastra/core/signals";
import { connect, type ConnectOptions } from "./index.js";
import { DesktopSignals, type DesktopSignalsOptions } from "./signals.js";

export { isTransportConnectionError } from "@mastra-cc/transport";

export {
  DesktopSignals,
  DEFAULT_DELIVERED_ATTRIBUTIONS,
  DEFAULT_DEDUPE_WINDOW_MS,
  changeSummary,
  type DesktopSignalsOptions,
  type DeliverAttribution,
} from "./signals.js";

// THE ADAPTER. @mastra/core is a PEER dependency and is imported only from this
// module, which is reachable only through the "@mastra-cc/desktop/mastra"
// subpath. The base entry point never touches it, so a runtime that has no
// agent framework installed can still install and import this package (C5).
//
// One tool per protocol method, and nothing else: no macro, no retry, no
// composite verb. Each tool's schema and description are GENERATED from
// protocol/schema.json (via METHOD_DESCRIPTORS) rather than written here, so a
// protocol change cannot leave a tool describing a surface that no longer
// exists. What the agent needs beyond the per-method description - sequencing,
// write-then-read, that a refusal is an answer - is the INSTRUCTIONS, which
// belong in the agent's prompt, not smeared across fourteen descriptions.

/** The text an agent must be given alongside these tools. Re-exported so a caller needs one import. */
export { INSTRUCTIONS } from "./index.js";

export type DesktopTools = Record<MethodName, ReturnType<typeof createTool>>;

/**
 * Build one Mastra tool per protocol method, bound to an already-open client.
 *
 * The client is dialled by the caller (`connect()` from the base entry) because
 * the lifetime of a connection is the caller's business: these tools do not
 * open, reopen or close one.
 *
 * A refusal from the daemon is returned as the daemon wrote it. Nothing here
 * inspects a result for a `refusal` field and turns it into a thrown error, or
 * softens its wording: the agent is supposed to read the refusal and decide.
 */
export function desktopTools(client: TransportClient): DesktopTools {
  const tools = {} as DesktopTools;
  for (const method of METHOD_NAMES) {
    const descriptor = METHOD_DESCRIPTORS[method];
    tools[method] = createTool({
      id: method,
      description: descriptor.description,
      inputSchema: descriptor.params,
      execute: async (input: unknown) => {
        const call = client[method] as (params: unknown) => Promise<unknown>;
        return await call.call(client, input ?? {});
      },
    });
  }
  return tools;
}

/**
 * One desk, held as one object.
 *
 * The instance IS the connection (ADR-0060, as amended). There is no agent id
 * anywhere on this surface: the identity of the agent is the instance it is
 * holding, so two agents are two instances and therefore two sockets, which is
 * what keeps the daemon's `self` attribution true without asking the daemon to
 * change. Everything obtained from one instance - the tools and the signal
 * provider - is bound to that instance's single dial.
 *
 * It lives here in the `/mastra` subpath rather than in the base entry because
 * a signal provider is a value import of `@mastra/core`, and the base entry has
 * to stay importable by a runtime that has no agent framework installed (C5).
 */
export class MastraCC {
  readonly #options: ConnectOptions;
  // The dial is a PROMISE, not a client, and it is created once. Storing the
  // promise rather than awaiting into a field is what makes two concurrent
  // first-callers share one connection instead of racing into two.
  #dial: Promise<TransportClient> | undefined;
  #closed = false;

  constructor(options: ConnectOptions = {}) {
    this.#options = options;
  }

  /**
   * The one connection, opened on first use.
   *
   * Lazy because constructing a desk should not be an I/O operation: a caller
   * assembling an agent at module scope has not yet decided to talk to anything.
   */
  client(): Promise<TransportClient> {
    // A closed instance stays closed. Re-dialling would silently hand back a
    // DIFFERENT connection: new daemon-side identity, empty subscription book,
    // and any provider still holding a listener on the old client would be
    // attached to a corpse while the tools quietly worked. That failure is
    // invisible, so it is refused instead - an instance is one connection for
    // its whole life (ADR-0060), and a caller who wants another builds another.
    // Rejected rather than thrown: this returns a promise, and a method that
    // sometimes throws synchronously is a method callers get wrong.
    if (this.#closed) {
      return Promise.reject(new Error("this MastraCC was closed; construct another to dial again"));
    }
    this.#dial ??= connect(this.#options);
    return this.#dial;
  }

  /**
   * One Mastra tool per protocol method, bound to this instance's connection.
   *
   * Delegates to the free `desktopTools` function, which stays exported and
   * unchanged: it is merged public surface, and a caller who already dials for
   * themselves has no reason to be broken by this class existing.
   *
   * Returned synchronously because `new Agent({ tools })` is assembled before
   * anything is dialled - each tool awaits the connection when it is actually
   * called, so building an agent never blocks on a desk being reachable.
   */
  getTools(): DesktopTools {
    // Each method forwards to the real client, dialling on first use. This is
    // delegation, not a second client: nothing here frames, correlates or opens
    // a socket - `connect()` does that, once (ADR-0003, pin B5).
    const deferred: Record<string, unknown> = {};
    for (const method of METHOD_NAMES) {
      deferred[method] = async (params: unknown) => {
        const client = await this.client();
        const call = client[method] as (p: unknown) => Promise<unknown>;
        return await call.call(client, params);
      };
    }
    return desktopTools(deferred as unknown as TransportClient);
  }

  /**
   * A signal provider bound to this instance's connection, delivering the
   * daemon's change events into one agent thread.
   *
   * The target is fixed here and for the provider's life: a notification needs
   * a thread, and "the instance is the connection" settles which AGENT is
   * speaking, not which THREAD is listening. Attach it with
   * `new Agent({ signals: [...] })` - that constructor is the only thing that
   * connects a provider to an agent, so an editor-configured agent cannot
   * carry one.
   */
  getSignalProvider(
    target: SignalProviderTarget,
    options?: DesktopSignalsOptions,
  ): DesktopSignals {
    return new DesktopSignals({ client: () => this.client(), target, options });
  }

  /**
   * Close the connection, if one was ever opened.
   *
   * Idempotent, and a no-op on an instance that never dialled: closing a desk
   * you never opened is not an error, and a caller unwinding a failed startup
   * should not have to know how far it got. It is also final: see `client()` for
   * why a closed instance refuses to dial again rather than opening a second,
   * different connection behind the caller's back.
   */
  async close(): Promise<void> {
    this.#closed = true;
    const dial = this.#dial;
    if (dial === undefined) return;
    this.#dial = undefined;
    (await dial).close();
  }
}

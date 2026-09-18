import { AsyncLocalStorage } from "node:async_hooks";
import { createTool } from "@mastra/core/tools";
import { METHOD_DESCRIPTORS, METHOD_NAMES, type CapturedImage, type MethodName } from "@mastra-cc/protocol-types";
import { describeCapture } from "./capture-geometry.js";
import type { TransportClient } from "@mastra-cc/transport";
import type { SignalProviderTarget } from "@mastra/core/signals";
import { connect, type ConnectOptions } from "./index.js";
import { DesktopSignals, type DesktopSignalsOptions } from "./signals.js";
import { EFFECT_METHODS, ObservationLedger } from "./observations.js";

export { isTransportConnectionError } from "@mastra-cc/transport";

export { ObservationLedger, EFFECT_METHODS, DEFAULT_QUIET_AFTER_EFFECT_MS, type ObservationEntry } from "./observations.js";

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
      // THE ONE ANSWER THAT IS NOT WORDS. Every other method's result is text a
      // model reads; this one is a picture, and a picture handed over as a
      // base64 field inside a JSON blob is a very long string that no model
      // looks at. So the picture is mapped into a media part - the shape a
      // provider actually renders - and the refusal, when there is one, stays
      // text. Nothing is invented here: an answer carrying no image is left
      // exactly as the daemon wrote it.
      ...(method === "captureElement"
        ? {
            toModelOutput: (output: unknown) => {
              const image = (output as { image?: CapturedImage } | undefined)?.image;
              if (image?.data === undefined) return undefined;
              // The picture AND what it is a picture of (ADR-0105). The crop
              // came over the wire so a clipped picture can be mapped to a
              // click; dropping it here would hand the model half a button
              // and let it aim at the middle.
              return {
                type: "content",
                value: [
                  { type: "media", data: image.data, mediaType: `image/${image.format ?? "png"}` },
                  { type: "text", text: describeCapture(image) },
                ],
              };
            },
          }
        : {}),
    } as Parameters<typeof createTool>[0]);
  }
  return tools;
}

/**
 * One desk, held as one object.
 *
 * The instance IS the connection (ADR-0060, amended by ADR-0101). Its tools
 * and signal provider share that dial and its subscriptions. Separate sockets
 * isolate subscriptions, not event causality. Native changes remain unattributed
 * without a causal witness, including events concurrent with this instance's effects.
 *
 * It lives here in the `/mastra` subpath rather than in the base entry because
 * a signal provider is a value import of `@mastra/core`, and the base entry has
 * to stay importable by a runtime that has no agent framework installed (C5).
 */
/**
 * How many tasks may WAIT for the desk before one is refused outright.
 *
 * A queue is a courtesy to a caller that arrived a moment early; it is not a
 * scheduler. A deep queue turns "the desk is busy" into a request that lands
 * minutes later against a desk the caller never observed - which is the
 * interleaving this serialization exists to prevent, arriving slowly.
 */
export const WAITING_TASK_LIMIT = 8;

/** Raised when the desk is held by another task and this caller cannot have it. */
export class DeskBusyError extends Error {
  readonly holder: string;
  constructor(holder: string, reason: string) {
    super(reason);
    this.name = "DeskBusyError";
    this.holder = holder;
  }
}

export class MastraCC {
  readonly #options: ConnectOptions;
  // The dial is a PROMISE, not a client, and it is created once. Storing the
  // promise rather than awaiting into a field is what makes two concurrent
  // first-callers share one connection instead of racing into two.
  #dial: Promise<TransportClient> | undefined;
  #closed = false;
  // One ledger per desk: what the active task knows about the elements it
  // cares about, fed by every pointer this connection receives regardless of
  // attribution, and stamped by every effect these tools dispatch.
  readonly #ledger = new ObservationLedger();
  // CC-05, the half the daemon cannot see: the daemon enforces ONE DRIVER, and
  // this connection is that driver. Two agent loops sharing this instance are
  // two drivers as far as the desk is concerned, and the daemon has no way to
  // tell them apart - one connection, one generation, two goals interleaving
  // keystrokes into whatever window happens to be focused. So the lease lives
  // here, where the two loops are distinguishable.
  static readonly #inTask = new AsyncLocalStorage<number>();
  #holder: { name: string; generation: number } | undefined;
  #generation = 0;
  #waiting: Array<() => void> = [];

  constructor(options: ConnectOptions = {}) {
    this.#options = options;
  }

  /**
   * Hold the desk for one complete task, and release it when the task is done.
   *
   * Effects dispatched from outside the holding task are refused while it
   * holds - not queued behind it, because an effect aimed from an observation
   * taken before someone else's task ran is aimed at a desk that no longer
   * exists. A caller that wants its turn asks for a turn, which is what this
   * is. Observations are never refused: looking at a desk someone else is
   * driving is how a second loop learns it should wait.
   *
   * A task that arrives while another holds WAITS, up to `WAITING_TASK_LIMIT`
   * waiters; past that the desk is honestly busy and says so rather than
   * accepting work it will run against an unrecognisable desk.
   */
  async withTask<T>(name: string, run: () => Promise<T>): Promise<T> {
    if (this.#holder !== undefined && this.#waiting.length >= WAITING_TASK_LIMIT) {
      throw new DeskBusyError(
        this.#holder.name,
        `this desk is held by the task ${JSON.stringify(this.#holder.name)} and ${this.#waiting.length} task(s) are already waiting - ` +
          "the desk takes one task at a time, and a queue this deep would run this one against a desk it never observed",
      );
    }
    if (this.#holder !== undefined) {
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    }
    this.#generation += 1;
    const holder = { name, generation: this.#generation };
    this.#holder = holder;
    try {
      // The generation travels with the async context rather than being passed
      // through every call: the tools an agent holds were built before the task
      // existed, and a lease a caller has to remember to carry is a lease the
      // second loop forgets to carry.
      return await MastraCC.#inTask.run(holder.generation, run);
    } finally {
      // Release even when the task threw: a failed task that keeps the desk
      // forever is a worse failure than the one it had.
      this.#holder = undefined;
      this.#waiting.shift()?.();
    }
  }

  /** The task holding this desk, or undefined when no task holds it. */
  get heldBy(): string | undefined {
    return this.#holder?.name;
  }

  /**
   * Refuse an effect dispatched from outside the task that holds this desk.
   *
   * Only effects (ADR-0108). An observation from a rival loop changes nothing
   * and refusing it would hide the desk from the loop that most needs to see
   * it is busy. A caller that holds no lease at all is not refused either -
   * a single-loop consumer that never asked for a task is not competing with
   * anyone, and serialization it did not ask for would be a breaking change
   * dressed as a safety feature. The rule is narrow on purpose: an effect
   * while ANOTHER task holds the desk.
   */
  #refuseRivalEffect(method: MethodName): void {
    const holder = this.#holder;
    if (holder === undefined || !EFFECT_METHODS.has(method)) return;
    if (MastraCC.#inTask.getStore() === holder.generation) return;
    throw new DeskBusyError(
      holder.name,
      `${method} was refused and nothing was sent: this desk is held by the task ${JSON.stringify(holder.name)}, ` +
        "and two tasks taking turns at one desk is two drivers however few connections they share - " +
        "wait for the desk with withTask, then observe it again before acting on it",
    );
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
    this.#dial ??= connect(this.#options).then((client) => {
      client.onChangeEvent((event) => this.#ledger.record(event));
      return client;
    });
    return this.#dial;
  }

  /**
   * The active task's view of what changed since it last looked - every
   * attribution, no content, no wake. `unattributed` pointers are not
   * delivered as wakes by default (see DesktopSignals); this is where they
   * land so that a task awaiting one can still see it (CC-06).
   */
  get observations(): ObservationLedger {
    return this.#ledger;
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
  getTools(options: { beforeDispatch?: () => void } = {}): DesktopTools {
    // Each method forwards to the real client, dialling on first use. This is
    // delegation, not a second client: nothing here frames, correlates or opens
    // a socket - `connect()` does that, once (ADR-0003, pin B5).
    const deferred: Record<string, unknown> = {};
    for (const method of METHOD_NAMES) {
      deferred[method] = async (params: unknown) => {
        // Checked before the dial and before any veto: a task that does not
        // hold the desk should not open a connection to find that out, and an
        // effect refused here has been refused everywhere it could be sent.
        this.#refuseRivalEffect(method);
        const client = await this.client();
        const call = client[method] as (p: unknown) => Promise<unknown>;
        // Synchronous and local to these tools: a caller may veto after the dial.
        options.beforeDispatch?.();
        // Stamped BEFORE the call, so an echo that lands while the call is
        // still in flight is already inside the quiet window.
        this.#ledger.noteEffect(method);
        const result = await call.call(client, params);
        // The watch is over the moment the daemon says so. A pointer for it
        // that was already on the wire is late, and must not wake anyone.
        if (method === "unsubscribeElement" && !(result as { refusal?: unknown }).refusal) {
          this.#ledger.endWatch(String((params as { subscriptionId?: unknown })?.subscriptionId ?? ""));
        }
        return result;
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
    return new DesktopSignals({ client: () => this.client(), target, options, ledger: this.#ledger });
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

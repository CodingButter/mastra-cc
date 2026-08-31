import { SignalProvider, type SignalProviderTarget } from "@mastra/core/signals";
import type { Attribution, ChangeEvent } from "@mastra-cc/protocol-types";
import type { TransportClient } from "@mastra-cc/transport";

// THE DESK SPEAKING FIRST. Everything else in this package is a question the
// agent thought to ask. This is the one path where the desk starts the
// conversation: the daemon pushes a content-free ChangeEvent down the
// connection the instance already holds, and this provider carries it into the
// agent's thread as a notification.
//
// @mastra/core is a PEER dependency, and this file imports it as a VALUE
// (SignalProvider is a base class). It is therefore reachable only through the
// "@mastra-cc/desktop/mastra" subpath, never from the base entry (C5).

/** Which attributions are carried into the thread. */
export type DeliverAttribution = Attribution;

/**
 * Deliver `external` only.
 *
 * A `self` event is the agent's own edit echoing back, so delivering it wakes
 * the agent to tell it what it just did - and since the wake can cause another
 * edit, the loop it opens looks like a hung agent rather than a bug.
 * `unattributed` is the subtle sibling: the daemon emits it precisely when it
 * CANNOT decide who acted, so it may well be the agent itself. Neither is
 * excluded because it is uninteresting; both are excluded because including
 * them cannot be done safely by default.
 *
 * Exported so the mutation gate has one thing to flip, and so a caller widening
 * it is reading this paragraph while they do it.
 */
export const DEFAULT_DELIVERED_ATTRIBUTIONS: readonly DeliverAttribution[] = ["external"];

/** How long one (subscription, element, kind) triple stays quiet after waking the agent. */
export const DEFAULT_DEDUPE_WINDOW_MS = 1000;

export interface DesktopSignalsOptions {
  /**
   * Which attributions to carry into the thread.
   * Defaults to {@link DEFAULT_DELIVERED_ATTRIBUTIONS}.
   */
  deliver?: readonly DeliverAttribution[];
  /**
   * Minimum gap between two wakes for the same subscription, element and kind.
   * Defaults to {@link DEFAULT_DEDUPE_WINDOW_MS}. Set to 0 to deliver everything.
   */
  dedupeWindowMs?: number;
}

/** @internal Everything the provider needs from the instance that made it. */
export interface DesktopSignalsDeps {
  client: () => Promise<TransportClient>;
  target: SignalProviderTarget;
  options?: DesktopSignalsOptions;
}

/**
 * The pointer-only summary of a change. Fixed here, asserted by test.
 *
 * A ChangeEvent carries no content, deliberately (ADR-0056), and neither does
 * this: role, kind and element id are all pointers. Reading the element to say
 * something more useful would smuggle content into a path designed not to carry
 * it - and would run the visibility gate on the agent's behalf without it
 * asking. If the agent wants to know what it says, it can call a tool.
 */
export function changeSummary(event: ChangeEvent): string {
  return `desktop ${event.kind}: ${event.role} ${event.id} (watch ${event.subscriptionId})`;
}

/**
 * Carries daemon change events into one agent thread.
 *
 * PUSH, NOT POLL. `pollInterval` stays undefined and neither `poll` nor
 * `handleWebhook` is implemented: the socket is already open and the events
 * already arrive on it, so a timer would only add latency and frames to a
 * stream that has neither.
 *
 * ONE THREAD. The target is fixed for the provider's life, because a
 * notification needs a threadId and a resourceId and nothing on the daemon's
 * wire says which thread called `subscribeElement`. Serving many threads from
 * one provider needs that, and is deferred (ADR-0061).
 */
export class DesktopSignals extends SignalProvider<"mastra-cc-desktop"> {
  readonly id = "mastra-cc-desktop" as const;
  readonly name = "mastra-cc desktop";

  readonly #client: () => Promise<TransportClient>;
  readonly #target: SignalProviderTarget;
  readonly #deliver: ReadonlySet<DeliverAttribution>;
  readonly #dedupeWindowMs: number;
  /** Last wake per (subscription, element, kind), in epoch ms. */
  readonly #lastWake = new Map<string, number>();
  #detach: (() => void) | undefined;

  constructor(deps: DesktopSignalsDeps) {
    super();
    this.#client = deps.client;
    this.#target = {
      ...deps.target,
      // Without this the notification is recorded and the idle thread is left
      // asleep - delivered, and unread until something else wakes it. A signal
      // that does not wake the agent is a log line with extra steps.
      ifIdle: deps.target.ifIdle ?? { behavior: "wake" },
    };
    this.#deliver = new Set(deps.options?.deliver ?? DEFAULT_DELIVERED_ATTRIBUTIONS);
    this.#dedupeWindowMs = deps.options?.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
  }

  /**
   * Attach the listener. Called by the framework after `connect()`, which is
   * the earliest moment an agent exists to notify.
   */
  async start(): Promise<void> {
    if (this.#detach !== undefined) return;
    const client = await this.#client();
    this.#detach = client.onChangeEvent((event) => {
      void this.#onChange(event);
    });
  }

  /**
   * Detach, and leave the connection open: the dial belongs to the MastraCC
   * instance, which may still be serving tools long after signals are done.
   */
  override stop(): void {
    this.#detach?.();
    this.#detach = undefined;
    this.#lastWake.clear();
    super.stop();
  }

  async #onChange(event: ChangeEvent): Promise<void> {
    if (!this.#deliver.has(event.attribution)) return;

    const key = `${event.subscriptionId}\u0000${event.id}\u0000${event.kind}`;
    if (this.#dedupeWindowMs > 0) {
      const last = this.#lastWake.get(key);
      // An honest throttle, not a judgement: this drops changes that are
      // genuinely distinct, because nothing here can tell a repeat from a
      // sequel. The agent is told the element moved, not how many times.
      if (last !== undefined && event.at - last < this.#dedupeWindowMs) return;
      this.#lastWake.set(key, event.at);
    }

    await this.notify(
      {
        source: this.id,
        kind: `desktop.${event.kind}`,
        summary: changeSummary(event),
        // Carried back unread, exactly as the daemon carried it. The daemon's
        // three priorities are a literal subset of Mastra's four, so there is
        // nothing to translate and no `urgent` to invent.
        priority: event.priority,
        sourceId: event.id,
        // Attribution belongs here and NOT in `source`: `source` is provider
        // identity and is the key delivery-policy overrides are written
        // against, so splitting it by attribution would make one integration
        // look like three.
        attributes: {
          attribution: event.attribution,
          subscriptionId: event.subscriptionId,
          role: event.role,
          changeKind: event.kind,
          at: event.at,
        },
        // These notifications persist - `transient` does not exist on this
        // path - so a chatty element would otherwise accumulate records.
        dedupeKey: key,
        coalesceKey: event.subscriptionId,
      },
      this.#target,
    );
  }
}

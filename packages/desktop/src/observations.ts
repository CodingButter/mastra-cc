import type { ChangeEvent, MethodName } from "@mastra-cc/protocol-types";

/**
 * The methods whose call can change what is on the desk. Everything else
 * observes, subscribes or describes. Kept explicit rather than derived from
 * descriptor prose: a gate should not depend on the wording of a docstring.
 */
export const EFFECT_METHODS: ReadonlySet<MethodName> = new Set<MethodName>([
  "openApplication",
  "restartApplication",
  "acquireAccessibility",
  "editElement",
  "activateElement",
  "submitElement",
  "setElementValue",
  "setElementText",
  "setElementCaret",
  "revealElement",
  "sendKeyChord",
  "typeText",
  "clearElementText",
  "clickElement",
]);

/**
 * How long after one of this session's own effects an `unattributed` pointer
 * is treated as possibly that effect's echo: recorded, never woken on.
 *
 * Not a claim that it WAS the echo - the daemon has no causal witness and says
 * so with `unattributed` - only that waking on it cannot be told apart from
 * waking on one's own edit, and a wake that can cause an edit that causes a
 * wake is the loop CC-06 exists to refuse. Measured native echoes arrive
 * within tens of milliseconds (cc09/native-latency: median 8 ms to storage);
 * the window is wide enough for a slow toolkit and short enough that a person
 * typing a second later is heard.
 */
export const DEFAULT_QUIET_AFTER_EFFECT_MS = 1500;

export interface ObservationEntry {
  /** Monotonic time (performance.now) of the last change pointer seen for this element. */
  changedAt: number;
  /** Monotonic time this element was last read by the caller, if ever noted. */
  observedAt: number | undefined;
  /** Attribution of the last pointer, exactly as the daemon said it. */
  attribution: ChangeEvent["attribution"];
  kind: ChangeEvent["kind"];
  /** True while a pointer has arrived since the caller last noted an observation. */
  stale: boolean;
}

/**
 * What the active task knows about the elements it cares about, fed by EVERY
 * change pointer the connection receives - `self`, `external` and
 * `unattributed` alike - independently of whether any of them woke the agent.
 *
 * This is the half of CC-06 that raw event availability does not cover: an
 * `unattributed` change that arrives while the task is mid-flight is not
 * delivered as a wake, and before this it was not recorded anywhere either,
 * so a task awaiting exactly that change could not see it. Now it is a stale
 * mark and a resolvable wait. Nothing here carries content (ADR-0056): the
 * ledger says "this element changed since you looked", and looking is a tool
 * call that runs the visibility gate as it always did.
 */
export class ObservationLedger {
  readonly #entries = new Map<string, ObservationEntry>();
  readonly #waiters = new Map<string, Set<(event: ChangeEvent) => void>>();
  // Watches this session has ended, by subscription id, newest last and
  // bounded like the entries: a pointer for one of these that was already on
  // the wire when the watch ended is late, not news.
  readonly #endedWatches = new Set<string>();
  readonly #watchEndedListeners = new Set<(subscriptionId: string) => void>();
  readonly #limit: number;
  #lastEffectAt = -Infinity;
  #effects = 0;
  readonly #quietMs: number;
  readonly #now: () => number;

  constructor(options: { limit?: number; quietAfterEffectMs?: number; now?: () => number } = {}) {
    this.#limit = options.limit ?? 1024;
    this.#quietMs = options.quietAfterEffectMs ?? DEFAULT_QUIET_AFTER_EFFECT_MS;
    this.#now = options.now ?? (() => performance.now());
  }

  /** Called by the tool layer when one of this session's effect methods is dispatched. */
  noteEffect(method: MethodName): void {
    if (!EFFECT_METHODS.has(method)) return;
    this.#effects += 1;
    this.#lastEffectAt = this.#now();
  }

  /** How many effect dispatches this session has made. Exposed for tests and for the self-loop proof. */
  get effects(): number {
    return this.#effects;
  }

  /**
   * Whether an `unattributed` pointer arriving now falls inside the quiet
   * window after this session's last effect. `external` and `self` are never
   * quieted here: the daemon already decided those.
   */
  inQuietWindow(event: Pick<ChangeEvent, "attribution">): boolean {
    if (event.attribution !== "unattributed") return false;
    return this.#now() - this.#lastEffectAt < this.#quietMs;
  }

  /**
   * The watch is over - the tool layer ended it, or the daemon said
   * `watchEnded`. Anyone holding pointers for it (the signal provider's
   * throttle) is told at once, and later pointers for it are late.
   */
  endWatch(subscriptionId: string): void {
    this.#endedWatches.delete(subscriptionId);
    this.#endedWatches.add(subscriptionId);
    if (this.#endedWatches.size > this.#limit) {
      const oldest = this.#endedWatches.values().next().value;
      if (oldest !== undefined) this.#endedWatches.delete(oldest);
    }
    for (const listener of this.#watchEndedListeners) listener(subscriptionId);
  }

  /** Whether this session has ended that watch. */
  watchEnded(subscriptionId: string): boolean {
    return this.#endedWatches.has(subscriptionId);
  }

  /** Hear every `endWatch`; returns the detach. */
  onWatchEnded(listener: (subscriptionId: string) => void): () => void {
    this.#watchEndedListeners.add(listener);
    return () => { this.#watchEndedListeners.delete(listener); };
  }

  /** Record a pointer. Every attribution, every kind; bounded by eviction of the oldest entry. */
  record(event: ChangeEvent): void {
    if (event.kind === "watchEnded") this.endWatch(event.subscriptionId);
    const at = this.#now();
    const previous = this.#entries.get(event.id);
    this.#entries.delete(event.id);
    this.#entries.set(event.id, { changedAt: at, observedAt: previous?.observedAt, attribution: event.attribution, kind: event.kind, stale: true });
    if (this.#entries.size > this.#limit) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
    const waiters = this.#waiters.get(event.id);
    if (waiters !== undefined) {
      this.#waiters.delete(event.id);
      for (const resolve of waiters) resolve(event);
    }
  }

  /** The caller has just read this element; it is no longer stale until the next pointer. */
  observed(id: string): void {
    const entry = this.#entries.get(id);
    const at = this.#now();
    if (entry === undefined) this.#entries.set(id, { changedAt: -Infinity, observedAt: at, attribution: "unattributed", kind: "changed", stale: false });
    else {
      entry.observedAt = at;
      entry.stale = false;
    }
  }

  /** Has a pointer for this element arrived since the caller last noted an observation? Unknown elements are not stale: nothing was ever seen to change. */
  stale(id: string): boolean {
    return this.#entries.get(id)?.stale ?? false;
  }

  entry(id: string): ObservationEntry | undefined {
    const entry = this.#entries.get(id);
    return entry === undefined ? undefined : { ...entry };
  }

  /**
   * Resolve with the next pointer for this element, or reject on abort. If the
   * element is already stale, resolves at once with a synthetic pointer built
   * from the recorded entry - a change the task has not yet consumed IS the
   * awaited change. Nothing here wakes anyone.
   */
  awaitChange(id: string, options: { signal?: AbortSignal } = {}): Promise<ChangeEvent> {
    const entry = this.#entries.get(id);
    if (entry?.stale) {
      return Promise.resolve({ subscriptionId: "", id, role: "generic", kind: entry.kind, attribution: entry.attribution, priority: "medium", at: entry.changedAt });
    }
    return new Promise<ChangeEvent>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(options.signal.reason instanceof Error ? options.signal.reason : new Error("aborted"));
        return;
      }
      let set = this.#waiters.get(id);
      if (set === undefined) {
        set = new Set();
        this.#waiters.set(id, set);
      }
      const done = (event: ChangeEvent) => {
        options.signal?.removeEventListener("abort", onAbort);
        resolve(event);
      };
      const onAbort = () => {
        set?.delete(done);
        if (set?.size === 0) this.#waiters.delete(id);
        reject(options.signal?.reason instanceof Error ? options.signal.reason : new Error("aborted"));
      };
      set.add(done);
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

import type { ChangeEvent } from "@mastra-cc/protocol-types";

export const SIGNAL_RETENTION_LIMIT = 256;
export const SIGNAL_WAKE_LIMIT = 32;
const WAKE_INTERVAL_MS = 1000;

type Entry = { at: number; pending?: ChangeEvent };

/** @internal Bounded pointer-only trailing coalescing; no desktop reads. */
export class SignalThrottle {
  readonly #entries = new Map<string, Entry>();
  #overflow: ChangeEvent | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #windowAt = performance.now();
  #wakes = 0;
  #stopped = false;

  constructor(readonly gapMs: number, readonly deliver: (event: ChangeEvent, overflow: boolean) => void) {
    if (!Number.isFinite(gapMs) || gapMs < 0) throw new RangeError("dedupeWindowMs must be finite and nonnegative");
  }

  get retainedCount(): number { return this.#entries.size + (this.#overflow === undefined ? 0 : 1); }

  push(event: ChangeEvent): void {
    if (this.#stopped) return;
    if (this.gapMs === 0) { this.deliver(event, false); return; }
    const now = performance.now();
    this.#expire(now);
    const key = `${event.subscriptionId}\u0000${event.id}\u0000${event.kind}`;
    let entry = this.#entries.get(key);
    if (entry === undefined) {
      if (this.#entries.size >= SIGNAL_RETENTION_LIMIT) {
        const oldest = this.#entries.keys().next().value!;
        const pending = this.#entries.get(oldest)?.pending;
        if (pending !== undefined && (this.#overflow === undefined || pending.priority === "high" || this.#overflow.priority === "low")) this.#overflow = pending;
        this.#entries.delete(oldest);
      }
      entry = { at: -Infinity };
      this.#entries.set(key, entry);
    }
    // Copy only protocol pointers; never retain accidental extra payload fields.
    entry.pending = { subscriptionId: event.subscriptionId, id: event.id,
      role: event.role, kind: event.kind, attribution: event.attribution, priority: event.priority, at: event.at };
    this.#flush(now);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#entries.clear();
    this.#overflow = undefined;
  }

  #expire(now: number): void {
    if (now - this.#windowAt >= WAKE_INTERVAL_MS) { this.#windowAt = now; this.#wakes = 0; }
    for (const [key, entry] of this.#entries) {
      if (entry.pending === undefined && now - entry.at >= Math.max(this.gapMs, WAKE_INTERVAL_MS)) this.#entries.delete(key);
    }
  }

  #flush(now: number): void {
    this.#expire(now);
    if (this.#overflow !== undefined && this.#wakes < SIGNAL_WAKE_LIMIT) {
      const event = this.#overflow;
      this.#overflow = undefined;
      this.#wakes++;
      this.deliver(event, true);
    }
    // Snapshot before rotating delivered keys, so this flush never revisits them.
    for (const [key, entry] of [...this.#entries]) {
      if (this.#stopped || this.#wakes >= SIGNAL_WAKE_LIMIT) break;
      if (entry.pending === undefined || now - entry.at < this.gapMs) continue;
      const event = entry.pending;
      entry.pending = undefined;
      entry.at = now;
      this.#entries.delete(key);
      this.#entries.set(key, entry);
      this.#wakes++;
      this.deliver(event, false);
    }
    if (!this.#stopped) this.#schedule(now);
  }

  #schedule(now: number): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#stopped) return;
    const budgetAt = this.#wakes >= SIGNAL_WAKE_LIMIT ? this.#windowAt + WAKE_INTERVAL_MS : now;
    let next = this.#overflow === undefined ? Infinity : budgetAt;
    for (const entry of this.#entries.values()) {
      const at = entry.pending === undefined ? entry.at + Math.max(this.gapMs, WAKE_INTERVAL_MS) : Math.max(entry.at + this.gapMs, budgetAt);
      next = Math.min(next, at);
    }
    if (!Number.isFinite(next)) return;
    this.#timer = setTimeout(() => { this.#timer = undefined; this.#flush(performance.now()); }, Math.min(2_147_483_647, Math.max(1, next - now)));
    this.#timer.unref?.();
  }
}

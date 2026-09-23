import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Cancellation is owned by the driver connection: closing it is the request,
 * and the daemon cannot retract a key already on the registry bus. What the
 * daemon CAN do is stop before the next one. A boundary is a point in an
 * effect where nothing is in flight - between two emitted keys - and it is
 * the only place stopping loses nothing. The signal travels with the request
 * through this store so the backend never learns what a connection is.
 */
const current = new AsyncLocalStorage<AbortSignal>();

export class CancelledAtBoundaryError extends Error {
  constructor(readonly emitted: number, readonly of: number) {
    super(
      emitted === 0
        ? "stopped before its first emission because the driver had already asked; nothing was sent, and the element requires fresh observation before anyone resumes"
        : `stopped at a supported boundary after ${emitted} of ${of} emissions; ` +
          "the emitted keys cannot be retracted and the element requires fresh observation before anyone resumes",
    );
  }
}

/** A subprocess the effect or observation is about to start can be told to stop by this; undefined outside any cancellable operation. */
export function cancellationSignal(): AbortSignal | undefined {
  return current.getStore();
}

export function underCancellation<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  return current.run(signal, work);
}

/** Called by an effect between emissions; throws when the owning connection has asked to stop. */
export function boundary(emitted: number, of: number): void {
  if (current.getStore()?.aborted) throw new CancelledAtBoundaryError(emitted, of);
}

import type { Backend } from "./backend.js";

export interface DriverConnection { readonly generation: number; closed: boolean; readonly signal: AbortSignal }
export const DRIVER_BUSY = "refused: another driver owns this desktop session; observation remains available, but effects require that driver to disconnect and its operation to settle";
export const DRIVER_CLOSED = "refused: this driver connection has closed; queued work was discarded, and any already-issued effects require fresh observation";

/**
 * Connection ownership outlives individual requests and retires only at
 * quiescence. Disconnecting is the cancellation request: the connection's
 * signal aborts so a running effect stops at its next supported boundary,
 * and ownership retires the moment that effect leaves. The retirement is the
 * acknowledgement - `settled` resolves then, and a successor's first effect
 * is admitted then, not before.
 */
export class DriverAuthority {
  #generation = 0;
  #owner: DriverConnection | undefined;
  // Requests now run concurrently across targets, so "running" is a count
  // per connection, not one slot for the whole desk.
  readonly #running = new Map<DriverConnection, number>();
  readonly #controllers = new WeakMap<DriverConnection, AbortController>();
  readonly #settled = new WeakMap<DriverConnection, { promise: Promise<number>; resolve: (at: number) => void }>();

  connect(): DriverConnection {
    const controller = new AbortController();
    const connection: DriverConnection = { generation: ++this.#generation, closed: false, signal: controller.signal };
    this.#controllers.set(connection, controller);
    let resolve!: (at: number) => void;
    const promise = new Promise<number>((r) => { resolve = r; });
    this.#settled.set(connection, { promise, resolve });
    return connection;
  }
  refusal(connection: DriverConnection, effect: boolean): string | undefined {
    if (connection.closed) return DRIVER_CLOSED;
    if (effect && this.#owner !== undefined && this.#owner !== connection) return DRIVER_BUSY;
    return undefined;
  }
  enter(connection: DriverConnection, effect: boolean): string | undefined {
    const refusal = this.refusal(connection, effect);
    if (refusal !== undefined) return refusal;
    if (effect) this.#owner = connection;
    this.#running.set(connection, (this.#running.get(connection) ?? 0) + 1);
    return undefined;
  }
  leave(connection: DriverConnection): void {
    const left = (this.#running.get(connection) ?? 1) - 1;
    if (left > 0) this.#running.set(connection, left);
    else this.#running.delete(connection);
    if (connection.closed) this.disconnect(connection);
  }
  disconnect(connection: DriverConnection): void {
    connection.closed = true;
    this.#controllers.get(connection)?.abort();
    if (this.running(connection)) return;
    if (this.#owner === connection) this.#owner = undefined;
    this.#settled.get(connection)?.resolve(performance.now());
  }
  running(connection: DriverConnection): boolean { return this.#running.has(connection); }
  /** Resolves with the monotonic time at which this connection held nothing: no authority, nothing running. */
  settled(connection: DriverConnection): Promise<number> {
    return this.#settled.get(connection)?.promise ?? Promise.resolve(performance.now());
  }
}

const authorities = new WeakMap<Backend, DriverAuthority>();
export function driverAuthority(backend: Backend): DriverAuthority {
  let authority = authorities.get(backend);
  if (authority === undefined) { authority = new DriverAuthority(); authorities.set(backend, authority); }
  return authority;
}

import type { Backend } from "./backend.js";

export interface DriverConnection { readonly generation: number; closed: boolean }
export const DRIVER_BUSY = "refused: another driver owns this desktop session; observation remains available, but effects require that driver to disconnect and its operation to settle";
export const DRIVER_CLOSED = "refused: this driver connection has closed; queued work was discarded, and any already-issued effects require fresh observation";

/** Connection ownership outlives individual requests and retires only at quiescence. */
export class DriverAuthority {
  #generation = 0;
  #owner: DriverConnection | undefined;
  #running: DriverConnection | undefined;

  connect(): DriverConnection { return { generation: ++this.#generation, closed: false }; }
  refusal(connection: DriverConnection, effect: boolean): string | undefined {
    if (connection.closed) return DRIVER_CLOSED;
    if (effect && this.#owner !== undefined && this.#owner !== connection) return DRIVER_BUSY;
    return undefined;
  }
  enter(connection: DriverConnection, effect: boolean): string | undefined {
    const refusal = this.refusal(connection, effect);
    if (refusal !== undefined) return refusal;
    if (effect) this.#owner = connection;
    this.#running = connection;
    return undefined;
  }
  leave(connection: DriverConnection): void {
    if (this.#running === connection) this.#running = undefined;
    if (connection.closed) this.disconnect(connection);
  }
  disconnect(connection: DriverConnection): void {
    connection.closed = true;
    if (this.#owner === connection && this.#running !== connection) this.#owner = undefined;
  }
}

const authorities = new WeakMap<Backend, DriverAuthority>();
export function driverAuthority(backend: Backend): DriverAuthority {
  let authority = authorities.get(backend);
  if (authority === undefined) { authority = new DriverAuthority(); authorities.set(backend, authority); }
  return authority;
}

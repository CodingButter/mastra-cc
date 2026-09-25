import { measureAsyncCost, recordCost } from "../costs.js";
import { type Backend } from "../backend.js";
import { applicationName } from "../backends/atspi/names.js";
import { serveConnection } from "./pipes.js";

// ONE QUEUE PER TARGET (C3). Calls on one application, or one browser
// target, run one at a time in arrival order. Calls on different targets do
// not wait for each other, so one frozen application stalls only its own
// queue. A call that names no single target - an unscoped query, the
// application listing - runs on its own SPANNING queue, and each application
// it reaches is bounded by the backend's per-call deadline (ADR-0114,
// ADR-0117). Order within one connection is kept separately by
// serveConnection, which dispatches a connection's requests one after another.
export const SPANNING = "*";
export const chains = new Map<string, Promise<unknown>>();
export function serialised<T>(target: string, work: () => Promise<T>): Promise<T> {
  const queued = performance.now();
  const measured = () => {
    recordCost("queueWait", performance.now() - queued);
    return measureAsyncCost("requestWork", work);
  };
  const next = (chains.get(target) ?? Promise.resolve()).then(measured, measured);
  const tail = next.catch(() => undefined);
  chains.set(target, tail);
  // forget an idle target, so the map is bounded by what is in flight
  void tail.then(() => {
    if (chains.get(target) === tail) chains.delete(target);
  });
  return next;
}

/** How many target queues hold work - for tests that idle queues are forgotten. */
export function queuedTargets(): number {
  return chains.size;
}

/** Which queue a request waits in: the application its element or scope names, else the spanning queue. */
export function targetOf(params: unknown, backend: Backend): string {
  if (params === null || typeof params !== "object") return SPANNING;
  const p = params as { id?: unknown; application?: unknown };
  // choosing a queue must never be what fails a request
  if (typeof p.id === "string" && typeof backend.applicationOfElement === "function") {
    const owner = backend.applicationOfElement(p.id);
    if (owner !== undefined) return `app:${applicationName(owner)}`;
  }
  if (typeof p.application === "string" && p.application !== "") return `app:${applicationName(p.application)}`;
  return SPANNING;
}

import type { ControlMode } from "./events";

// THE CONTROL STATION. Who is allowed to touch the desk right now, held in one
// place on the server so the answer cannot differ between the browser's overlay
// and the agent's tool.
//
// A module singleton, and that is a real limit stated rather than hidden: one
// process, one desk, one person. This is a demo of a single machine being shared
// by an agent and its owner, and a second visitor would be sharing that person's
// keyboard. Making it multi-tenant means keying this by session, and that is a
// product decision, not a refactor.
//
// The agent CANNOT take control back. `request` unlocks the desk and then waits;
// only `release`, called by the browser when a person presses Done, resolves it.
// An agent that could re-lock the desk on its own could lock a person out of
// their own machine, and no demo is worth shipping that shape.

type Waiter = {
  requestId: string;
  resolve: (note: string) => void;
  reject: (error: Error) => void;
};

export class ControlWaitEndedError extends Error {}

let mode: ControlMode = "view";
let reason: string | undefined;
let waiter: Waiter | undefined;
let counter = 0;

const listeners = new Set<(state: ControlState) => void>();

export type ControlState = { mode: ControlMode; reason?: string; requestId?: string };

export function controlState(): ControlState {
  return { mode, reason, requestId: waiter?.requestId };
}

export function watchControl(listener: (state: ControlState) => void): () => void {
  listeners.add(listener);
  listener(controlState());
  return () => listeners.delete(listener);
}

function announce() {
  const state = controlState();
  for (const listener of listeners) listener(state);
}

/** Hand the desk to the person and wait for them. Resolves only when they say they are done. */
export function requestControl(
  why: string,
  timeoutMs: number,
  signal?: AbortSignal,
): { requestId: string; done: Promise<string> } {
  signal?.throwIfAborted();
  waiter?.reject(new ControlWaitEndedError("handover superseded; this agent must stop"));
  counter += 1;
  const requestId = `handover-${counter}`;
  mode = "interact";
  reason = why;
  const done = new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (note?: string, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(note!);
    };
    const abort = () => finish(undefined, new ControlWaitEndedError("handover wait cancelled; the person still has control"));
    const timer = setTimeout(() => {
      finish(undefined, new ControlWaitEndedError("handover timed out; the person still has control until they press Done"));
    }, timeoutMs);
    timer.unref?.();
    // Keep the request ID after the waiter ends: the person's Done button must
    // still release their control, but cannot revive the stopped agent.
    waiter = {
      requestId,
      resolve: (note) => finish(note),
      reject: (error) => finish(undefined, error),
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
  announce();
  return { requestId, done };
}

/** The person pressed Done. Locks the desk again and lets the waiting agent continue. */
export function release(requestId: string, note = "the person says they are done"): boolean {
  if (waiter?.requestId !== requestId) return false;
  const pending = waiter;
  waiter = undefined;
  mode = "view";
  reason = undefined;
  announce();
  pending.resolve(note);
  return true;
}

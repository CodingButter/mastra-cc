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

type Waiter = { requestId: string; resolve: (note: string) => void };

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
export function requestControl(why: string, timeoutMs: number): { requestId: string; done: Promise<string> } {
  // A previous request that nobody answered is abandoned rather than queued: the
  // desk is already unlocked, and stacking waiters would leave one of them to be
  // resolved by a Done press meant for the other.
  waiter?.resolve("superseded by a later request");
  counter += 1;
  const requestId = `handover-${counter}`;
  mode = "interact";
  reason = why;
  const done = new Promise<string>((resolve) => {
    waiter = { requestId, resolve };
    // Bounded, because a tool call that never returns is a hung agent with no
    // explanation. The timeout is an ANSWER the agent has to read - "nobody
    // confirmed" - not a silent success.
    setTimeout(() => {
      if (waiter?.requestId === requestId) release(requestId, "nobody confirmed within the waiting time");
    }, timeoutMs).unref?.();
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

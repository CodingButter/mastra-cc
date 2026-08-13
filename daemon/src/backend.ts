import { randomBytes } from "node:crypto";
import type {
  AttestElementParams,
  AttestElementResult,
  ChangeKind,
  QueryElementsParams,
  QueryElementsResult,
  Role,
} from "@mastra-cc/protocol-types";

// The backend seam: one defined interface, per-platform implementations that
// must implement every method, conformance enforced by the shared suite in
// __tests__/backend-conformance.test.ts - every backend that ever exists is
// registered into that suite and run through it.

// What a backend reports when something in a watched subtree changes. Identity,
// role and kind - nothing else. A backend never states an attribution, because
// a backend cannot know what verb the daemon has in flight; the server stamps
// that (ADR-0039).
export interface BackendChange {
  id: string;
  role: Role;
  kind: ChangeKind;
}

// A live watch, as the backend sees it. `application` is a fact about the tree
// that only the backend can state - which application the watched root lives
// in - and the server uses it to decide attribution. The backend supplies the
// fact; it never draws the conclusion.
export interface BackendSubscription {
  readonly subscriptionId: string;
  readonly application: string;
  close(): Promise<void>;
}

// The watched id was never answered by this backend - it may never have
// existed, or it may belong to an application this session cannot see. The
// server refuses both byte-identically (ADR-0008 rule 6, ADR-0036), so the two
// cases must not be distinguishable from here either.
export class UnwatchableElementError extends Error {}

// An id that names no watch on this connection.
export class UnknownSubscriptionError extends Error {}

// This route cannot watch anything yet. Named rather than silent: a watch that
// is accepted and then says nothing is indistinguishable from a quiet desktop.
export class WatchUnsupportedError extends Error {}

// This route registered for its signals, caused one of its own, and never
// heard it come back. A subclass of WatchUnsupportedError because it is the
// same promise being kept - no route may hand back a watch that will never
// speak - but named separately because the cause is different: not "not built
// yet" but "built, and deaf right now" (the M0.5 spike's finding: a missing
// registration fails silently and looks identical to a calm desktop).
export class DeafWatchError extends WatchUnsupportedError {}

// A registered watch on a channel's own reader. Closing it stops the sink
// being fed; it never closes the channel. Seam vocabulary, not transport
// vocabulary: both routes register watches, and neither borrows the other's
// shape to do it.
export interface ChannelWatch {
  close(): Promise<void>;
}

// One recorded change, in the order it arrived. `afterMs` is provenance for a
// human reading the tape - how long after the watch began the change came -
// and is never replayed as a timer.
export interface TapeEvent {
  afterMs: number;
  subscribedTo: string;
  change: BackendChange;
}

// The replay side of the event direction, shared by both replay flavours: the
// events this tape recorded for this root, in recorded order, delivered
// immediately. Never on a timer - the offline lane proves order and content,
// and says nothing about timing.
export function replayWatch(
  events: TapeEvent[],
  subscribedTo: string,
  sink: (change: BackendChange) => void,
): ChannelWatch {
  let open = true;
  queueMicrotask(() => {
    for (const event of events) {
      if (!open) return;
      if (event.subscribedTo !== subscribedTo) continue;
      sink(event.change);
    }
  });
  return {
    async close() {
      open = false;
    },
  };
}

// Subscription ids are minted, never derived from the element: two watches on
// the same element are two different watches, and a client holding both must be
// able to end one of them.
let minted = 0;
export function mintSubscriptionId(): string {
  minted += 1;
  return `sub-${minted.toString(16).padStart(6, "0")}-${randomBytes(3).toString("hex")}`;
}

export interface Backend {
  readonly name: string;
  queryElements(params: QueryElementsParams): Promise<QueryElementsResult>;
  attestElement(params: AttestElementParams): Promise<AttestElementResult>;
  subscribeElement(id: string, sink: (change: BackendChange) => void): Promise<BackendSubscription>;
  unsubscribeElement(subscriptionId: string): Promise<void>;
  close(): Promise<void>;
}

export const BACKEND_METHODS = [
  "queryElements",
  "attestElement",
  "subscribeElement",
  "unsubscribeElement",
  "close",
] as const;

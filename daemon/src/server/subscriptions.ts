import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { PRIORITIES, type Attribution, type ChangeEvent, type Priority } from "@mastra-cc/protocol-types";
import type { SubscribeElementResult, UnsubscribeElementResult } from "../results.js";
import { type Backend, type BackendChange, type BackendSubscription, DeafWatchError, UnknownSubscriptionError, UnwatchableElementError, WatchUnsupportedError } from "../backend.js";
import { refused, type Classified } from "../audit.js";
import { applicationName } from "../backends/atspi/names.js";
import { isVisible, type Visibility } from "../grants.js";
import { Request } from "./dispatch.js";
import { openApplication } from "./launch-focus.js";

// The change stream (ADR-0039). Both subscription methods are observe-class:
// a watch reads and cannot cause anything. They are on the wire before either
// route can serve them, on ADR-0037's reasoning - the contract is the thing
// being frozen, and a method that does not exist cannot be refused honestly.
// Until a backend can watch a subtree, these name the check that ran and what
// would change the answer; the behaviour arrives route by route, and the
// refusal for a route that will never serve it stays exactly here.
// A watch on an id this session's backend never answered. ONE constant for
// "no such element" and "an element inside an application this session cannot
// see": the byte-equality is the security property (ADR-0008 rule 6,
// ADR-0036), exactly as it is for an unavailable application.
export const SUBSCRIBE_UNKNOWN_REFUSAL =
  'refused by the change stream: no element with that id is known to this daemon (never answered, or forgotten after newer answers) - a watch is established on something this session has read, and nothing else';

// A watch is per-connection state: the connection that asked is the one that
// is fed, and the watch dies with it. A subscribe arriving outside a
// connection has nowhere to be delivered, and an event with no listener is a
// watch that says nothing.
export const SUBSCRIBE_NO_CONNECTION_REFUSAL =
  'refused by the change stream: "subscribeElement" was called outside a connection - a watch is per-connection state, and there is nowhere to deliver its events';

export const SUBSCRIBE_PRIORITY_REFUSAL =
  `refused by the change stream: "priority" must be one of ${PRIORITIES.join(", ")} - the daemon carries the label back unread, but it will not carry one the schema does not define`;

export const SUBSCRIBE_UNSUPPORTED_REFUSAL =
  'refused by the change stream: "subscribeElement" is defined by the schema but this session\'s backend cannot yet watch an element for changes - the watch would be accepted and then say nothing, which is indistinguishable from a quiet desktop, so it is refused instead';

// The route is built and DEAF RIGHT NOW: it registered for its signals,
// caused one of its own as a probe, and the probe never arrived. Distinct
// from "not built yet" above because the remedy is different, and the
// distinction must be legible in the transcript - a deaf daemon must never
// run as if it could hear (the M0.5 spike: a missing registration fails
// silently and looks identical to a calm desktop).
export const SUBSCRIBE_DEAF_REFUSAL =
  "refused by the change stream: the accessibility route registered for its signals, caused one of its own, and never heard it come back - a watch handed back deaf is indistinguishable from a quiet desktop, so no watch was established";

export const UNSUBSCRIBE_UNKNOWN_REFUSAL =
  'refused by the change stream: "unsubscribeElement" was given a subscription this connection does not hold - a watch is per-connection state, and ending one that was never established would report a change of state that did not happen';

// ---------------------------------------------------------------------------
// The change stream's server half (ADR-0039).
//
// Backends report pointer shapes and application membership, not causal witnesses.
// Request identity is retained for audit receipts only (ADR-0101).

export interface Cause {
  causeId: string;
  /** the application the verb names, once the verb is allowed to name one */
  application?: string;
}

// Request-local identity for audit receipts, not evidence about event origin.
export const operation = new AsyncLocalStorage<Cause | undefined>();

export function mintCauseId(): string {
  return `cause-${randomBytes(6).toString("hex")}`;
}

// A verb names its target once it is allowed to: openApplication does so only
// after the permit check has passed, because resolving a name against the
// catalog before authority would be the capability probe ADR-0019 forbids.
// Until a verb names one, every concurrent change is unattributed - the daemon
// abstains rather than guessing.
export function causeNames(application: string): void {
  const current = operation.getStore();
  if (current !== undefined) current.application = application;
}

export interface AttributionStamp {
  attribution: Attribution;
  causeId?: string;
}

// Audit attribution of the commanded operation, never of a native change event.
// The request context proves who issued the operation, not what caused a later pointer.
export function attribute(changeApplication: string, cause: Cause | undefined = operation.getStore()): AttributionStamp {
  if (cause !== undefined) {
    if (cause.application !== undefined && applicationName(cause.application) === applicationName(changeApplication)) {
      return { attribution: "self", causeId: cause.causeId };
    }
    // The receipt has no matching authorized target in this request context.
    return { attribution: "unattributed" };
  }
  // This audit receipt is outside a commanded effect's request context.
  return { attribution: "external" };
}

export interface OpenSubscription {
  readonly id: string;
  readonly priority: Priority;
  readonly application: string;
  readonly backendSubscription: BackendSubscription;
  /** false once the root vanished and the watch ended itself */
  alive: boolean;
  /** Pointers held back while the consumer is not reading (ADR-0106): the
   *  newest change per element, at most STALLED_CONSUMER_POINTERS of them.
   *  undefined while the consumer keeps up. */
  held?: Map<string, Pick<BackendChange, "role" | "kind">>;
}

/**
 * How the book sees the pipe it writes into (ADR-0106). `pending` is how many
 * bytes the pipe has accepted and not yet handed to the peer; `onDrain` fires
 * when that returns to zero. A consumer that reads keeps pending near zero. A
 * consumer that has STOPPED reading makes it grow without bound - and the
 * daemon retains every byte of it, which the CC-09 measurement put at ~124 B
 * an event, linear, with nothing deciding.
 */
export interface PipePressure {
  pending(): number;
  onDrain(handler: () => void): void;
}

/**
 * Past this many unsent bytes toward one connection the consumer is not slow,
 * it is stopped: at the measured ~124 B per event that is ~2100 events, which
 * at the recorded native cadence of ~10 changes a second is over three
 * minutes of not reading. A kernel socket buffer alone absorbs ~500 events
 * before Node holds any, so a reader that is merely busy never reaches this.
 */
export const STALLED_CONSUMER_PENDING_BYTES = 256 * 1024;

/**
 * Per stalled watch, how many distinct elements' newest changes are kept for
 * delivery once the consumer reads again. Beyond this the oldest is forgotten.
 * An event is a pointer with no content (ADR-0039), so what a consumer loses
 * when pointers are collapsed is only WHICH intermediate things changed, and
 * it must reobserve on any pointer anyway.
 */
export const STALLED_CONSUMER_POINTERS = 64;
/** Requests a connection may have unanswered before the daemon stops reading
 *  it (ADR-0106 amendment). Bounds the answers that can pile up at once. */
export const MAX_IN_FLIGHT_REQUESTS = 64;

// One connection's watches. The book belongs to the socket: it is created when
// the connection is accepted and emptied when it closes, and no watch outlives
// the client that asked for it.
export class SubscriptionBook {
  private readonly open = new Map<string, OpenSubscription>();
  private closed = false;
  constructor(
    private readonly emit: (event: ChangeEvent) => void,
    // Visibility is re-checked where events are STAMPED, not only where
    // subscriptions are created: a grant is a statement about now, and an
    // application that has left the visible set must stop being narrated
    // mid-watch (ADR-0036).
    private readonly visibility: Visibility = "all",
    // How full the pipe is. Absent for a book whose emit is not a pipe (tests,
    // in-process consumers): nothing is ever held back.
    private readonly pressure?: PipePressure,
  ) {
    pressure?.onDrain(() => this.release());
  }

  async subscribe(backend: Backend, id: string, priority: Priority): Promise<string> {
    if (this.closed) throw new Error("watch connection has closed");
    // Bound initialization pointers; overflow refuses the watch rather than
    // silently claiming coverage after dropping its first changes.
    const pending: BackendChange[] = [];
    let overflow = false;
    let subscriptionId = "";
    const backendSubscription = await backend.subscribeElement(id, (change: BackendChange) => {
      if (this.closed || overflow) return;
      if (subscriptionId === "") {
        if (pending.length < 256) pending.push({ ...change });
        else overflow = true;
        return;
      }
      this.deliver(subscriptionId, change);
    });
    if (this.closed || overflow) {
      pending.length = 0;
      await backendSubscription.close();
      throw new Error(this.closed ? "watch connection closed during initialization" : "watch initialization exceeded its bounded event buffer; observe again before subscribing");
    }
    subscriptionId = backendSubscription.subscriptionId;
    this.open.set(subscriptionId, {
      id,
      priority,
      application: backendSubscription.application,
      backendSubscription,
      alive: true,
    });
    for (const change of pending) this.deliver(subscriptionId, change);
    pending.length = 0;
    return subscriptionId;
  }

  private deliver(subscriptionId: string, change: BackendChange): void {
    const entry = this.open.get(subscriptionId);
    if (entry === undefined || !entry.alive) return;
    // An application outside the visible set is ABSENT, not filtered-with-a-
    // notice: nothing is emitted at all, which is byte-identical to the quiet
    // desktop an ungranted application is supposed to look like.
    if (!isVisible(this.visibility, entry.application)) return;
    // A consumer that has stopped reading is not written to (ADR-0106). The
    // change is HELD - newest per element, bounded - and delivered when the
    // pipe drains. The one exception is the watch's own end, which is one
    // line and the last one: holding it would leave a dead watch looking
    // alive to a consumer that eventually reads.
    if (change.kind !== "watchEnded" && this.stalled(entry)) {
      const held = (entry.held ??= new Map());
      held.delete(change.id);
      held.set(change.id, { role: change.role, kind: change.kind });
      if (held.size > STALLED_CONSUMER_POINTERS) held.delete(held.keys().next().value as string);
      return;
    }
    this.write(subscriptionId, entry, change);
  }

  private stalled(entry: OpenSubscription): boolean {
    if (entry.held !== undefined) return true;
    return this.pressure !== undefined && this.pressure.pending() > STALLED_CONSUMER_PENDING_BYTES;
  }

  /** The pipe drained: hand every stalled watch its held pointers, in the
   *  order they were last touched. */
  private release(): void {
    if (this.closed) return;
    for (const [subscriptionId, entry] of this.open) {
      const held = entry.held;
      if (held === undefined) continue;
      entry.held = undefined;
      if (!entry.alive) continue;
      for (const [id, change] of held) this.write(subscriptionId, entry, { id, ...change });
    }
  }

  private write(subscriptionId: string, entry: OpenSubscription, change: Pick<BackendChange, "id" | "role" | "kind">): void {
    // Native pointers carry no causal witness: overlap and silence prove neither origin.
    const stamp: AttributionStamp = { attribution: "unattributed" };
    this.emit({
      subscriptionId,
      id: change.id,
      role: change.role,
      kind: change.kind,
      attribution: stamp.attribution,
      ...(stamp.causeId === undefined ? {} : { causeId: stamp.causeId }),
      priority: entry.priority,
      at: Date.now(),
    });
    if (change.kind === "watchEnded") {
      // The root is gone. The watch ends here and says which element it was
      // watching; it is NEVER re-anchored by name onto whatever took the
      // element's place (ADR-0038's lesson, ADR-0039).
      entry.alive = false;
      void entry.backendSubscription.close();
    }
  }

  async end(subscriptionId: string): Promise<boolean> {
    const entry = this.open.get(subscriptionId);
    if (entry === undefined) throw new UnknownSubscriptionError(subscriptionId);
    this.open.delete(subscriptionId);
    // Ending a watch that already ended itself is not an error: the answer
    // says the watch is not running, which is the state the caller wanted
    // either way.
    if (!entry.alive) return false;
    await entry.backendSubscription.close();
    return true;
  }

  async closeAll(): Promise<void> {
    this.closed = true;
    for (const entry of this.open.values()) {
      if (entry.alive) await entry.backendSubscription.close();
    }
    this.open.clear();
  }

  get size(): number {
    return this.open.size;
  }

  // Which element a watch is on. The record names the element a subscription
  // was established on and the one it ended on, and it can only ask before the
  // book forgets - the answer is read here rather than reconstructed after.
  watchedElement(subscriptionId: string): string | undefined {
    return this.open.get(subscriptionId)?.id;
  }
}

export async function subscribeElement(
  params: { id?: unknown; priority?: unknown },
  backend: Backend,
  book: SubscriptionBook | undefined,
): Promise<Classified<SubscribeElementResult>> {
  if (book === undefined) return { refusal: SUBSCRIBE_NO_CONNECTION_REFUSAL, refusalClass: "NoConnection" };
  const id = typeof params.id === "string" ? params.id : "";
  const priority = params.priority;
  if (typeof priority !== "string" || !(PRIORITIES as readonly string[]).includes(priority)) {
    return { refusal: SUBSCRIBE_PRIORITY_REFUSAL, refusalClass: "MalformedParameter" };
  }
  try {
    const subscriptionId = await book.subscribe(backend, id, priority as Priority);
    // The id is echoed so a client holding several watches can bind this
    // answer to the request that asked for it without keeping its own book.
    // A watch is a standing read, so the receipt names the element it was
    // established ON - the changes it goes on to deliver do not each write an
    // entry of their own, because the access the record is about is the one
    // granted here.
    return { subscription: { subscriptionId, id, priority: priority as Priority }, auditElement: [{ id }] };
  } catch (error) {
    if (error instanceof UnwatchableElementError) return { refusal: SUBSCRIBE_UNKNOWN_REFUSAL, refusalClass: "WatchUnknownElement" };
    // Deaf before unsupported: DeafWatchError is the narrower promise-keeping
    // (built, and cannot hear right now) and must not be reported as "not
    // built yet".
    if (error instanceof DeafWatchError) return { refusal: SUBSCRIBE_DEAF_REFUSAL, refusalClass: "WatchDeaf" };
    if (error instanceof WatchUnsupportedError) return { refusal: SUBSCRIBE_UNSUPPORTED_REFUSAL, refusalClass: "WatchUnsupported" };
    throw error;
  }
}

export async function unsubscribeElement(
  params: { subscriptionId?: unknown },
  book: SubscriptionBook | undefined,
): Promise<Classified<UnsubscribeElementResult>> {
  const subscriptionId = typeof params.subscriptionId === "string" ? params.subscriptionId : "";
  if (book === undefined) return { refusal: UNSUBSCRIBE_UNKNOWN_REFUSAL, refusalClass: "UnknownSubscription" };
  // Asked before the book forgets: ending a watch is the close of a standing
  // read, and the receipt says which element stopped being watched.
  const watched = book.watchedElement(subscriptionId);
  try {
    return { ended: await book.end(subscriptionId), ...(watched === undefined ? {} : { auditElement: [{ id: watched }] }) };
  } catch (error) {
    if (error instanceof UnknownSubscriptionError) return { refusal: UNSUBSCRIBE_UNKNOWN_REFUSAL, refusalClass: "UnknownSubscription" };
    throw error;
  }
}

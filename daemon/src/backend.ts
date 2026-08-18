import { randomBytes } from "node:crypto";
import type {
  ActivateElementParams,
  ActivateElementResult,
  AttestElementParams,
  AttestElementResult,
  ChangeKind,
  EditElementParams,
  EditElementResult,
  QueryElementsParams,
  QueryElementsResult,
  RevealElementParams,
  RevealElementResult,
  Role,
  SetElementCaretParams,
  SetElementCaretResult,
  SetElementTextParams,
  SetElementTextResult,
  SetElementValueParams,
  SetElementValueResult,
  SubmitElementParams,
  SubmitElementResult,
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

// The effect half's error vocabulary, built on the observe half's precedent
// above. Each names a DIFFERENT reason a verb did not happen, because a client
// that cannot tell them apart cannot act on any of them.

// The id was never answered by this backend - it may never have existed, or it
// may belong to an application this session cannot see. Refused byte-identically
// to a non-existent element for the same reason UnwatchableElementError is
// (ADR-0008 rule 6, ADR-0036): the refusal must not become an existence oracle.
export class UnperformableElementError extends Error {}

// This route does not perform this verb. Named rather than silently returning
// the element unchanged: a verb that quietly does nothing and reports the world
// it failed to change is indistinguishable from a verb that worked.
export class EffectUnsupportedError extends Error {}

// A recording cannot be acted upon. A subclass of EffectUnsupportedError
// because it is the same promise - this route will not perform - but named
// separately because the cause is different: not "not built" but "this is a
// tape". Inventing an outcome here is the failure `replay-invents-a-reply-for-
// an-unrecorded-exchange` already pins on the reading side.
export class RecordingNotPerformableError extends EffectUnsupportedError {}

// The element does not publish the interface this operation is performed
// through - a text box with no editable-text interface, a slider with no value
// interface. This is `not-exposed` (ADR-0045, schema 1.4.0): a fact about the
// application, NOT a refusal a setting could lift. It must never be reported in
// a policy shape, because telling an agent a setting could change this answer
// is the false-belief failure ADR-0042 exists to kill.
export class OperationNotExposedError extends Error {}

// The magnitude asked for is outside the range the ELEMENT published. Refused
// before the call rather than clamped, because the platform clamps silently and
// then reports success: a value that lands somewhere other than where it was
// aimed is a wrong value that returned true (ADR-0045 clause 4).
export class MagnitudeOutOfRangeError extends Error {}

// The offset asked for is outside the element's own text. Same reasoning,
// measured: an insert at offset 99999 into a nine-character field was clamped,
// performed, and reported success (docs/proofs/can-node-act-on-the-desktop.md).
export class TextOffsetOutOfRangeError extends Error {}

// The element does not publish the action that was named. The published list is
// the only vocabulary a call may use, and a name outside it is refused rather
// than guessed at - performing "the closest one" is the ACTIONS_BY_ROLE mistake
// with a search function bolted on (ADR-0045 clause 2).
export class UnpublishedActionError extends Error {}

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

// EVERY EFFECT METHOD BELOW VERIFIES BY OBSERVATION, NEVER BY RETURN CODE.
// Each returns the element AS IT READS AFTERWARDS - a fresh read of the tree,
// never the caller's input echoed back. This is not a stylistic preference: it
// is the measured behaviour of the platform underneath. An insert at offset
// 99999 into a nine-character field was clamped, performed, and reported
// success (docs/proofs/can-node-act-on-the-desktop.md), and window move on this
// session returns true and moves nothing. A backend that trusts its own return
// value reports a world that does not exist.
//
// The split between the two groups is ADR-0045's, and it is structural rather
// than stylistic. ACTIONS are unparameterised verbs read off the element and
// performed by INDEX - `DoAction(in index:i) -> b` is the entire input surface
// the platform offers, and Windows and macOS publish the same parameterless
// shape - so an action carrying a magnitude is impossible, not merely
// unimplemented. OPERATIONS are the small designed neutral set that carries
// typed arguments, each backend expressing them in its own native units, with
// the magnitude bounded by the range the ELEMENT published. No unit crosses
// this seam that the element did not declare.
export interface Backend {
  readonly name: string;
  queryElements(params: QueryElementsParams): Promise<QueryElementsResult>;
  attestElement(params: AttestElementParams): Promise<AttestElementResult>;
  subscribeElement(id: string, sink: (change: BackendChange) => void): Promise<BackendSubscription>;
  unsubscribeElement(subscriptionId: string): Promise<void>;

  // The three effect verbs (schema 1.2.0's contracts, unchanged and not
  // redesigned here). Each throws UnperformableElementError for an id this
  // backend never answered, and EffectUnsupportedError where the route does not
  // perform at all.
  editElement(params: EditElementParams): Promise<EditElementResult>;
  // The action name must be one the ELEMENT published, matched verbatim.
  // Anything else is UnpublishedActionError - never the nearest match, never a
  // normalised synonym: click, doDefault and activate stay distinct.
  activateElement(params: ActivateElementParams): Promise<ActivateElementResult>;
  submitElement(params: SubmitElementParams): Promise<SubmitElementResult>;

  // The four operations (schema 1.4.0, ADR-0045). An element that does not
  // publish the interface an operation is performed through throws
  // OperationNotExposedError - `not-exposed`, a fact about the application,
  // never a policy-shaped refusal.
  setElementValue(params: SetElementValueParams): Promise<SetElementValueResult>;
  setElementText(params: SetElementTextParams): Promise<SetElementTextResult>;
  setElementCaret(params: SetElementCaretParams): Promise<SetElementCaretResult>;
  revealElement(params: RevealElementParams): Promise<RevealElementResult>;

  close(): Promise<void>;
}

export const BACKEND_METHODS = [
  "queryElements",
  "attestElement",
  "subscribeElement",
  "unsubscribeElement",
  "editElement",
  "activateElement",
  "submitElement",
  "setElementValue",
  "setElementText",
  "setElementCaret",
  "revealElement",
  "close",
] as const;

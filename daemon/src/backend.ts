import { randomBytes } from "node:crypto";
import type { Classified } from "./audit.js";
import type { InventoryEntry } from "./inventory.js";
import type {
  ActivateElementParams,
  ActivateElementResult,
  AttestElementParams,
  AttestElementResult,
  ChangeKind,
  DiscoverElementsParams,
  DiscoverElementsResult,
  EditElementParams,
  EditElementResult,
  QueryElementsParams,
  QueryElementsResult,
  ReadElementContentParams,
  ReadElementContentResult,
  RevealElementParams,
  RevealElementResult,
  SendKeyChordParams,
  SendKeyChordResult,
  Role,
  SemanticElement,
  SetElementCaretParams,
  SetElementCaretResult,
  SetElementTextParams,
  SetElementTextResult,
  TypeTextParams,
  TypeTextResult,
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

// The verb returned success and the read-back disagrees with what was asked
// for. This is the hazard that makes the whole observation contract necessary
// rather than decorative: an insert at offset 99999 into a nine-character field
// was clamped to somewhere else, performed, and reported success. A backend
// that reported that call as an edit would be describing a world that does not
// exist, so the disagreement is raised rather than smoothed over.
export class WriteNotObservedError extends Error {}

// This route cannot enumerate what the machine has installed. A fact about the
// route, never about the machine: the browser protocol answers for one browser
// and a recorded tape recorded a tree rather than a catalogue, so neither can
// say what is installed and neither pretends to. An empty list would be a
// claim that nothing is installed, which is the false belief ADR-0042 exists
// to prevent, so the seam refuses instead of answering emptily.
export class InventoryUnsupportedError extends Error {}

// WHETHER AN APPLICATION IS ANSWERING RIGHT NOW (issue #53).
//
// Three states rather than a boolean, for the reason schema.json:236 gives
// about availability: "it is not running" and "I have no way to tell you" are
// different facts, and a caller told the first when the second is true forms a
// false belief - it launches a second copy of something already open, or reads
// an empty result as an absent application.
//
// This is deliberately NOT the availability vocabulary. Availability answers
// whether THIS SESSION MAY PERFORM a capability; running-ness is a fact about
// the desktop that no permission grants and no setting starts. Borrowed shape,
// separate type.
export type RunningState = "answering" | "not-answering" | "cannot-tell";

// A backend's census of what is answering. Two fields, because the set of names
// a route can SEE and the set of names it can SPEAK ABOUT are different sets,
// and collapsing them is what turns "I never had a view of that" into "it is
// not running".
//
// `answersFor` is the horizon. "every-application" means absence from
// `observable` is itself a measurement - the route enumerated the whole desktop
// and this name was not on it. A name set means the route can only speak about
// those names: the browser route dials one debugging endpoint and has no view
// of anything else on the machine, so it says so rather than reporting the rest
// of the desktop closed.
export interface RunningCensus {
  // Names answering right now, NFKC-normalised, case-folded exactly as the inventory and
  // grants layers normalise them (backends/atspi/names.ts). A third
  // normalisation rule here would silently disagree with both.
  readonly observable: ReadonlySet<string>;
  readonly answersFor: "every-application" | ReadonlySet<string>;
}

// What a census says about one normalised name. The only reader of the two
// fields' relationship, so the "absent but out of horizon is cannot-tell" rule
// is written once rather than at every call site.
export function runningStateOf(census: RunningCensus, normalisedName: string): RunningState {
  if (census.observable.has(normalisedName)) return "answering";
  if (census.answersFor === "every-application") return "not-answering";
  return census.answersFor.has(normalisedName) ? "not-answering" : "cannot-tell";
}

// The element does not publish the action that was named. The published list is
// the only vocabulary a call may use, and a name outside it is refused rather
// than guessed at - performing "the closest one" is the ACTIONS_BY_ROLE mistake
// with a search function bolted on (ADR-0045 clause 2).
export class UnpublishedActionError extends Error {}

// This route cannot read or restore focus. A fact about the instrument, not
// about the desktop: a recording holds the focus a tree had when it was
// captured and cannot move it, and a route that answered "focus is unchanged"
// would be claiming a measurement it never took. ADR-0044 clause 4 is explicit
// that a best-effort silence is worse than none, so the seam refuses and the
// server reports the refusal rather than a clean launch.
export class FocusUnsupportedError extends Error {}

// The walk hit its own budget before it finished the tree. A partial tree
// returned as if it were the whole one is the false-belief failure ADR-0042
// exists to kill, measured: KDE's editor sits at depth 11 and node 195 of a
// 1030-node application, so a 150-node cap answered "no editor here" about a
// desktop that plainly had one. The bounds stay - a walk must be finite - but
// exhausting them is reported rather than smoothed into a short answer.
export class IncompleteObservationError extends Error {}

// The DAEMON cannot describe what this commit would do, so it refuses to make
// it (ADR-0008 rule 2: "a commit the service cannot describe is a commit nobody
// can review"). This is not a judgement of the caller's attestation - the
// caller's sentence is their restatement, and the daemon has no way to check
// whether it is true. It is the daemon's own inability, and it is the only
// honest reason to stop: the machine's description is what a human would
// review, and there is nothing to review if the machine cannot write one.
//
// It sits on the SEAM rather than in the server because only the backend can
// answer it. Describing a commit means reading the element as it stands and
// saying which of its own verbs would fire; a server that guessed from the id
// would be inventing exactly the description this error exists to demand.
export class AttestationFailedError extends Error {}

// The daemon's own description of a commit, derived from the element as it
// stands. Shared by both routes deliberately: the question "can this machine
// say what it is about to do" has one answer, and two routes answering it
// differently would make the refusal a property of the instrument rather than
// of the commit.
//
// An element is describable when it names itself and publishes exactly one
// verb. Both halves are load-bearing and neither is a formality. A nameless
// element yields "click something" - a sentence a reviewer cannot act on. An
// element publishing several verbs yields a description that names one of them
// while a different one might fire, and approving a guess is worse than
// refusing outright. The refusal names the check that ran and what would change
// the answer, per the schema's contract for every refusal on this wire.
//
// NOT carried on the wire. The submit result's shape is frozen (element |
// refusal) and this phase does not redesign it; the description's job here is
// to exist or to stop the commit. The surface that shows it to a human is the
// face's, and it reads the same function.
export function commitDescription(element: { name: string; actions: { name: string }[] }): string {
  const verbs = element.actions.map((action) => action.name);
  if (element.name.trim() === "") {
    throw new AttestationFailedError(
      `refused by the attestation check: this daemon cannot describe what committing on this element would do - the element publishes no name, so any description would name nothing (it publishes ${JSON.stringify(verbs)}); an element that names itself can be described`,
    );
  }
  if (verbs.length !== 1) {
    throw new AttestationFailedError(
      `refused by the attestation check: this daemon cannot describe what committing on ${JSON.stringify(element.name)} would do - it publishes ${verbs.length === 0 ? "no verb to perform" : `${verbs.length} verbs (${JSON.stringify(verbs)}) and which one commits would be a guess`}; an element publishing exactly one verb can be described`,
    );
  }
  return `perform ${JSON.stringify(verbs[0])} on ${JSON.stringify(element.name)}`;
}

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
  discoverElements(params: DiscoverElementsParams): Promise<DiscoverElementsResult>;
  // The refusal a backend writes here carries the CLASS it belongs to
  // (daemon/src/audit.ts), stated where the sentence is written rather than
  // recovered by reading the sentence back: the record names categories, and a
  // category parsed out of prose is a guess dressed as a fact.
  attestElement(params: AttestElementParams): Promise<Classified<AttestElementResult>>;
  readElementContent(params: ReadElementContentParams): Promise<Classified<ReadElementContentResult>>;
  subscribeElement(id: string, sink: (change: BackendChange) => void): Promise<BackendSubscription>;
  unsubscribeElement(subscriptionId: string): Promise<void>;

  // Which application an id this backend answered lives in, or undefined for an
  // id it never answered. The same fact BackendSubscription.application states,
  // asked about an element rather than about a watch - and only the backend can
  // state it, because it is a fact about the tree (the seam's own words at
  // BackendSubscription above).
  //
  // It exists because a verb cannot be attributed to itself without it. The
  // server mints a cause id for every effect verb, but attribute() answers
  // `self` only when the cause NAMES the application the change happened in;
  // with no name it answers `unattributed`, which is the honest answer to "we
  // do not know" and the wrong one for a change the daemon just caused. This is
  // the question openApplication answers from the catalog and an element verb
  // has no catalog to ask.
  //
  // Deliberately not a promise of knowledge: an id this backend never answered
  // gets undefined, the verb names nothing, and every concurrent change stays
  // unattributed. The daemon abstains rather than guessing (ADR-0039).
  applicationOfElement(id: string): string | undefined;

  // What this machine has installed, read from OUTSIDE every application
  // (ADR-0042). Names only: no window, no element, no text, no path and no
  // command line - the fence around an application described from outside it.
  //
  // It is on the seam because discovery is a platform question (ADR-0017): a
  // desktop entry directory is a Linux fact, and a route that has no way to
  // enumerate throws InventoryUnsupportedError rather than answering an empty
  // list. Empty means "this machine has nothing installed", and a route that
  // said that when it simply could not look would teach a caller the exact
  // falsehood this milestone exists to correct.
  //
  // Permission is NOT decided here. The backend says what exists; the server
  // says what may be done with it, from the same tables that enforce it.
  installedApplications(): Promise<InventoryEntry[]>;

  // WHAT IS ANSWERING RIGHT NOW (issue #53). The other half of the sentence
  // installedApplications() starts: that method reads the machine's catalogue
  // from outside every application, and this one asks the running desktop which
  // of those names is present at this instant.
  //
  // "Running" means OBSERVABLE, not "a process exists". The daemon does not
  // read the process table for this, and the distinction is not pedantry: a
  // process the bus cannot see cannot be acted on, so reporting it running
  // would promise an agent a desktop it cannot touch - and reading /proc for
  // arbitrary applications is a wider authority than observing, which issue
  // #53 explicitly refuses to take.
  //
  // A route with no view answers with a HORIZON rather than an empty set
  // (RunningCensus above), because an empty answer is the claim that nothing is
  // running, which is the same false belief InventoryUnsupportedError exists to
  // prevent one question earlier.
  //
  // Permission is NOT decided here, exactly as it is not in
  // installedApplications(): the backend says what is answering, the server
  // says whom it may tell.
  runningApplications(): Promise<RunningCensus>;

  // WHAT CURRENTLY HOLDS FOCUS, and how to put it back (ADR-0044).
  //
  // Two methods rather than one, because they answer different questions and
  // fail for different reasons. focusedElement() is a READ: it reports the
  // element the platform says has focus right now, or undefined when nothing
  // does - an empty desktop is a real answer and not a failure. restoreFocus()
  // is an EFFECT, and like every effect on this seam it VERIFIES BY READING
  // THE WORLD BACK: it returns the element that holds focus AFTER it tried,
  // read from the tree, so a route whose restore call returned true and moved
  // nothing is caught by the caller comparing that answer against what it
  // asked for. Neither method returns a boolean success, because a boolean is
  // exactly the return-code evidence this seam refuses (ADR-0047).
  //
  // These are observe-and-repair rather than a new capability class: the daemon
  // uses them to leave focus where it found it, which is the absence of an
  // effect rather than one the caller asked for. A route that cannot do either
  // throws FocusUnsupportedError, and the launch reports that it could not
  // protect the focus instead of reporting a clean launch.
  focusedElement(): Promise<SemanticElement | undefined>;
  restoreFocus(id: string): Promise<SemanticElement | undefined>;

  // The three effect verbs (schema 1.2.0's contracts, unchanged and not
  // redesigned here). Each throws UnperformableElementError for an id this
  // backend never answered, and EffectUnsupportedError where the route does not
  // perform at all.
  editElement(params: EditElementParams): Promise<EditElementResult>;
  // The action name must be one the ELEMENT published, matched verbatim.
  // Anything else is UnpublishedActionError - never the nearest match, never a
  // normalised synonym: click, doDefault and activate stay distinct.
  activateElement(params: ActivateElementParams): Promise<ActivateElementResult>;
  // Submit performs a commit the machine can DESCRIBE. The backend derives that
  // description from the element as it stands - its own name and its own single
  // published verb - and throws AttestationFailedError when it cannot, which is
  // the ATTESTATION_FAILED refusal (ADR-0008 rule 2). The caller's attestation
  // is carried, never validated against it: two restatements of the same commit
  // are both honest, and the daemon has no way to rank them.
  submitElement(params: SubmitElementParams): Promise<SubmitElementResult>;

  // The four operations (schema 1.4.0, ADR-0045). An element that does not
  // publish the interface an operation is performed through throws
  // OperationNotExposedError - `not-exposed`, a fact about the application,
  // never a policy-shaped refusal.
  setElementValue(params: SetElementValueParams): Promise<SetElementValueResult>;
  setElementText(params: SetElementTextParams): Promise<SetElementTextResult>;
  setElementCaret(params: SetElementCaretParams): Promise<SetElementCaretResult>;
  revealElement(params: RevealElementParams): Promise<RevealElementResult>;

  // RAW INPUT, the most restricted class this contract has (ADR-0046,
  // ADR-0067). It is on the seam and not above it for the same reason every
  // other effect is: how a key reaches a desktop is a platform question, and a
  // route that has no way to deliver one throws EffectUnsupportedError rather
  // than pretending it sent something.
  //
  // What it does NOT do is decide whether it may. The capability is composed at
  // boot and enforced in the server before this method is reached, exactly like
  // the other verbs - a backend that checked authority would be a second
  // permission system, disagreeing quietly with the first.
  //
  // It returns the element as it reads AFTERWARDS and nothing else, because
  // there is nothing else honest to return: the emission's own reply is `()`
  // whether the key landed on this element, on another window, or nowhere
  // (measured; see backends/atspi/rawinput/keys.ts). The read back is the whole
  // of the evidence (ADR-0047).
  sendKeyChord(params: SendKeyChordParams): Promise<SendKeyChordResult>;

  // The second raw-input method (ADR-0070): a run of printable text delivered
  // as keystrokes to whatever holds focus, aimed by grabbing the element's
  // focus first. Same authority, same fence, same read-back-is-the-evidence
  // contract as sendKeyChord. What may be in the text is decided in the
  // server before this is reached; the backend types what it is given.
  typeText(params: TypeTextParams): Promise<TypeTextResult>;

  close(): Promise<void>;
}

export const BACKEND_METHODS = [
  "queryElements",
  "attestElement",
  "subscribeElement",
  "unsubscribeElement",
  "applicationOfElement",
  "installedApplications",
  "runningApplications",
  "focusedElement",
  "restoreFocus",
  "editElement",
  "activateElement",
  "submitElement",
  "setElementValue",
  "setElementText",
  "setElementCaret",
  "revealElement",
  "sendKeyChord",
  "typeText",
  "close",
] as const;

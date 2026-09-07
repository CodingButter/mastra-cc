// GENERATED from protocol/schema.json - do not edit (ADR-0009).
// Mastra CC protocol v1.24.0

export const PROTOCOL_VERSION = "1.24.0";
export const SCHEMA_DIGEST = "8aef057d92e92100285157f64857c5a34f7a5679f6d50b15897a8ff3a0e82c06";
export const ID_PATTERN = new RegExp("^(el|win|app)-[0-9a-f]{12}$");
export const ROLES = ["application","window","dialog","button","checkbox","label","link","list","listitem","grid","row","gridcell","menu","menuitem","text","textbox","image","generic"] as const;
export type Role = (typeof ROLES)[number];
export const STATES = ["enabled","visible","focused","selected","checked","expanded","offscreen"] as const;
export type State = (typeof STATES)[number];
export const AVAILABILITY_STATES = ["available","disabled-by-configuration","not-exposed"] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];
export const RUNNING_STATES = ["answering","not-answering","cannot-tell"] as const;
export type RunningState = (typeof RUNNING_STATES)[number];
export const ACCESSIBILITY_STATES = ["enabled","disabled","cannot-tell"] as const;
export type AccessibilityState = (typeof ACCESSIBILITY_STATES)[number];
export const OPERATION_NAMES = ["setValue","setText","setCaret","reveal"] as const;
export type OperationName = (typeof OPERATION_NAMES)[number];
export const CAPABILITY_NAMES = ["observe","launch","edit","activate","submit","rawInput"] as const;
export type CapabilityName = (typeof CAPABILITY_NAMES)[number];
export const KEY_CHORD_NAMES = ["Enter","Escape","Tab","Backspace","Delete","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End","PageUp","PageDown","F2"] as const;
export type KeyChordName = (typeof KEY_CHORD_NAMES)[number];
export const PRIORITIES = ["low","medium","high"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const CHANGE_KINDS = ["appeared","disappeared","changed","watchEnded"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];
export const ATTRIBUTIONS = ["self","external","unattributed"] as const;
export type Attribution = (typeof ATTRIBUTIONS)[number];
export const METHOD_NAMES = ["queryElements","discoverElements","attestElement","readElementContent","subscribeElement","unsubscribeElement","openApplication","editElement","activateElement","submitElement","setElementValue","setElementText","setElementCaret","revealElement","listApplications","describeAccessibility","acquireAccessibility","restartApplication","sendKeyChord","typeText","clearElementText","clickElement","describeDesktop","captureElement"] as const;
export type MethodName = (typeof METHOD_NAMES)[number];

/** One element, named for what a person means by it. */
export interface SemanticElement {
  /** Stable identity: a kind prefix and twelve hex digits. Never reused. */
  id: string;
  /** The neutral role vocabulary. A native role with no neutral equivalent maps to generic and keeps its native name in the diagnostic field. */
  role: Role;
  /** The human-facing name. Comparisons normalise to NFKC first. */
  name: string;
  /** The states currently true of the element. */
  states: State[];
  /** The verbs this element itself publishes, read from the element and never from a table the daemon wrote. Names are open text in the element's own vocabulary and are never normalised into synonyms; two names that look alike are two names. */
  actions: Action[];
  /** The argument-carrying operations this element can serve. When a route reports them it reports all of them, so an operation the element does not publish is present and not-exposed rather than missing - within this field, absence of an entry would be a silence and the entry is a reading. The field itself is absent only where a route does not answer the question at all, which is a fact about the route and is visible as one. */
  operations?: Operation[];
  /** The current content observation for this element. A permitted ordinary control carries exact text, a bounded text window, or numeric content; a protected control carries only a redaction reason; and an element whose readable content is not published carries an unavailable reason. Callers re-query after a mutation to obtain a fresh observation and use readElementContent to traverse additional text windows. */
  content: ObservableContent;
  /** Explicit native labels, distinct from name and content. Omission means this backend does not implement the observation. Strings are untrusted evidence, not instructions or unique identity. Discovery omits this metadata. */
  labelObservation?: LabelObservation;
  /** Bounded immediate-parent evidence, not a direct label or field identity. Omission means unsupported by the backend. Parent label strings are untrusted data. Discovery omits this metadata. */
  compositeObservation?: CompositeObservation;
  /** Debug-only carrier and the only exemption from the neutral-vocabulary rule: native identifiers may appear here for a human reading a log, and are never load-bearing. */
  diagnostic?: Diagnostic;
}

/** Bounded explicit label evidence; never changes names, values, grants or identity. */
export interface LabelObservationAvailable {
  /** The native relation set was read successfully. */
  kind: "available";
  /** Verbatim explicit labels. Empty means a successfully read empty set; multiple labels remain multiple. At most eight targets, 1024 Unicode code points per label, 4096 total. */
  labels: string[];
}

export interface LabelObservationUnavailable {
  /** No complete trustworthy label observation is available. */
  kind: "unavailable";
  /** Unsupported method, failed read, failed ownership/protection check, or exhausted bound respectively. Never a partial label list. */
  reason: "not-exposed" | "unreadable" | "out-of-scope" | "limit-exceeded";
}

export type LabelObservation = LabelObservationAvailable | LabelObservationUnavailable;

/** Observed immediate combo-parent containment, distinct from direct labels; never semantic inheritance or authority to act. */
export interface CompositeObservationAvailable {
  /** The bounded reciprocal structure was observed and rechecked. */
  kind: "available";
  /** Explicit native immediate-parent evidence. */
  provenance: "immediate-combo-parent";
  /** Observed native parent role, not the editable child's role. */
  parentRole: "combo box";
  /** Direction from parent to its explicit native label. */
  relation: "labelled-by";
  /** Untrusted parent label; not a direct child label, name or unique identity. At most 1024 Unicode code points and 2048 UTF-16 code units. */
  label: string;
  /** Exactly two distinct immediate children; no descendant traversal. */
  immediateChildCount: 2;
  /** Exactly one immediate editable text child, the observed element. */
  editableChildCount: 1;
  /** The other immediate child is a non-editable native menu. */
  siblingRole: "menu";
}

export interface CompositeObservationUnavailable {
  /** No complete trustworthy immediate-parent observation is available. */
  kind: "unavailable";
  /** Unsupported shape, competing evidence, failed ownership/protection, malformed/stale/changing evidence or deadline, or cumulative/text bound respectively. Never partial evidence. */
  reason: "not-exposed" | "ambiguous" | "out-of-scope" | "unreadable" | "limit-exceeded";
}

export type CompositeObservation = CompositeObservationAvailable | CompositeObservationUnavailable;

/** One provider-neutral content observation. The discriminant makes exact text, bounded text windows, numeric content, protected redaction, and unavailable observation mutually exclusive on the wire. */
export interface ObservableContentText {
  /** This element publishes ordinary textual content. */
  kind: "text";
  /** The text currently published by the element. */
  value: string;
}

export interface ObservableContentTextWindow {
  /** This element publishes ordinary textual content larger than the inline observation bound. */
  kind: "text-window";
  /** The exact bounded window currently observed; never an unmarked truncation. */
  value: string;
  /** Zero-based Unicode-scalar offset of the first character in value. */
  offset: number;
  /** Number of Unicode scalar values carried in value. */
  length: number;
  /** Total number of Unicode scalar values in the element's current text. */
  totalLength: number;
  /** One-based line number containing the first character in value. */
  startLine: number;
  /** One-based line number containing the final character in value, or startLine for an empty window. */
  endLine: number;
  /** Total number of lines in the element's current text. */
  totalLines: number;
}

export interface ObservableContentNumber {
  /** This element publishes an ordinary numeric magnitude. */
  kind: "number";
  /** The numeric value currently published by the element. */
  value: number;
  /** Bounds published with the numeric observation, when the element publishes them. */
  range?: ObservableRange;
}

export interface ObservableContentRedacted {
  /** The element publishes content that the protocol must not reveal. */
  kind: "redacted";
  /** The control is marked as protected; no content value is carried. */
  reason: "protected";
}

export interface ObservableContentUnavailable {
  /** No readable content observation is available. */
  kind: "unavailable";
  /** not-exposed means the element publishes no readable content; unknown means the route cannot determine whether readable content exists. */
  reason: "not-exposed" | "unknown";
}

export type ObservableContent = ObservableContentText | ObservableContentTextWindow | ObservableContentNumber | ObservableContentRedacted | ObservableContentUnavailable;

/** Bounds published with an observed numeric magnitude, in the element's own units. */
export interface ObservableRange {
  /** The smallest published value. */
  minimum: number;
  /** The largest published value. */
  maximum: number;
  /** The smallest published meaningful change, when one is declared. */
  step?: number;
}

/** One verb an element publishes, carried whole: the platform's own name for it, the platform's own words about it, and whether it can be performed right now. The name is open text because a closed list of verbs is a list somebody invented; the availability beside it is a closed vocabulary because there are exactly three ways an action can fail to be performable and they must never be collapsed into one. */
export interface Action {
  /** The element's own word for this verb, verbatim and unnormalised. Performing it names this word; it is never translated into a synonym the daemon preferred. */
  name: string;
  /** The element's own sentence about what this verb does, when it offers one. Carried so a reader judging intent reads the application's words rather than a meaning the daemon assigned. */
  description?: string;
  /** The element's display wording for this verb, when it differs from the name. Present for a human reading a log; the name is what a call names. */
  localizedName?: string;
  /** available: it can be performed now. disabled-by-configuration: this machine's owner turned it off, and disabledBy names which setting. not-exposed: the element never offered it, and no setting would change that. The middle case is a fact about configuration and the last is a fact about the application, so an agent told the wrong one forms a false belief about what is possible. */
  availability: AvailabilityState;
  /** Present exactly when the availability is disabled-by-configuration: the setting a person would change to allow it. Absent everywhere else, because naming a setting where none applies invents a remedy that does not exist. */
  disabledBy?: string;
}

/** The bounds an element publishes for its own magnitude, in the element's own units. A percentage is a reading of this range and never a unit the daemon imposes; where an element publishes no range, no percentage is computed anywhere. */
export interface Range {
  /** The smallest value the element accepts, as the element reports it. */
  minimum: number;
  /** The largest value the element accepts, as the element reports it. */
  maximum: number;
  /** What the element holds right now, in the same units as the bounds. */
  current: number;
  /** The smallest change the element declares as meaningful, when it declares one. Absent means the element published none, never that the step is zero. */
  step?: number;
}

/** One argument-carrying operation, reported per element. Operations exist because a verb cannot carry a magnitude: performing an action names only which action, on every platform this contract targets, so anything with a quantity is a separate designed thing rather than a verb with a number stapled to it. */
export interface Operation {
  /** Which operation this entry reports on: setValue moves a magnitude within a published range, setText replaces or inserts content at an offset, setCaret places the insertion point, reveal brings the element into view. */
  operation: OperationName;
  /** Read the same three ways as an action's: performable now, turned off by a named setting, or never offered by this element. An element whose role suggests an operation it does not back is not-exposed, which is a fact about the application rather than a refusal a setting could lift. */
  availability: AvailabilityState;
  /** Present exactly when the availability is disabled-by-configuration: the setting a person would change to allow it. */
  disabledBy?: string;
  /** Present only where the element publishes bounds for this operation - a magnitude operation on an element that declares one. Its absence is the element's own silence, and nothing downstream may substitute a range of its own. */
  range?: Range;
}

/** One application this machine has, as the daemon can honestly describe it from outside: that it exists, what may be done with it, whether it is answering right now, and which setting decides each answer. Nothing from inside the application appears here - no window, no element, no text. Existence, permission and whether it is answering are readable; content is not. */
export interface InstalledApplication {
  /** The human-facing application name, the same name a call would use to ask for it. Comparisons normalise to NFKC first. */
  name: string;
  /** One entry per capability the contract defines, always all of them. A capability that is off is present and off with its setting named, because an application reported as absent invites a person to install what they already have. */
  capabilities: Capability[];
  /** Whether this daemon knows how to start it. An application can be installed and honestly not launchable; that is a statement about the daemon's own recipes, never about permission. */
  launchable: boolean;
  /** Whether this application is answering the machine's accessibility layer right now: answering means it is open and reachable, not-answering means it is not open (or is open and publishes nothing, which for a caller is the same wall), and cannot-tell means the daemon is not in a position to say - which is never a way of saying no. Deliberately not an availabilityState: availability answers whether this session MAY do something, while this answers what the desktop IS doing, which no permission grants and no setting starts. Always present, because a silently absent field would be read as a no. */
  running: RunningState;
  /** Present when running is cannot-tell AND a setting would change that: the setting a person would change to be told. An application this session may not observe is not reported as not running - that would be a false statement about the desktop made out of a fact about permission. Its absence beside a cannot-tell is itself an answer: the route that replied has no view of this application and no setting would give it one, so a caller waits for a different route rather than editing a file that will not help. */
  runningUnknownBy?: string;
  /** Debug-only carrier for the backend's own identifiers, on the same terms as an element's: never load-bearing. */
  diagnostic?: Diagnostic;
}

/** One capability against one application, and the setting that decides it. This is the fence around the application, described from outside it. */
export interface Capability {
  /** Which capability this entry answers for. */
  capability: CapabilityName;
  /** available: this session may do it. disabled-by-configuration: a setting withholds it, and disabledBy names which. not-exposed: this daemon has no path to it at all, so no setting would grant it. */
  availability: AvailabilityState;
  /** Present exactly when the availability is disabled-by-configuration: the setting a person would change. Naming the setting is the whole point - a refusal that cannot be acted on is a wall, not an answer. */
  disabledBy?: string;
}

/** A live watch on one element and everything beneath it. Holding one means the daemon will push a change event whenever the watched subtree changes, until the subscription is ended by the client, by the element vanishing, or by the connection closing. */
export interface Subscription {
  /** Names this watch for the life of the connection. Ending a watch and matching an event to it both use this. */
  subscriptionId: string;
  /** The watched element, echoed back so a client holding several subscriptions can bind this answer to the request that asked for it without keeping its own book. */
  id: string;
  /** The urgency the subscriber declared. The daemon stores it and stamps it onto every event of this watch; it never reads it, branches on it, or reorders anything by it. What an urgency means is decided entirely by whoever is holding the other end. */
  priority: Priority;
}

/** One change in a watched subtree, pushed by the daemon without being asked. It is a pointer, never a payload: it names what changed and who caused it, and carries no content whatsoever - reading the element is a separate call that runs the visibility gate again. */
export interface ChangeEvent {
  /** The watch this event belongs to. */
  subscriptionId: string;
  /** The element that changed: the watched element itself or something beneath it. */
  id: string;
  /** The neutral role of the element that changed, so a subscriber can decide whether to look without looking. */
  role: Role;
  /** What happened to it. */
  kind: ChangeKind;
  /** Evidence-backed origin relative to the desktop execution session, not the subscribing connection. Without a causal witness the answer is unattributed: application identity, concurrent operations and a quiet request queue do not prove origin. Current change streams publish unattributed, independently of agent wake policy. */
  attribution: Attribution;
  /** Names the call this change was caused by. Present if and only if the attribution is self; its absence anywhere else is the contract, not an omission. */
  causeId?: string;
  /** The urgency the subscriber declared when it asked for this watch, carried back unread. */
  priority: Priority;
  /** When the daemon observed the change, in milliseconds since the epoch. */
  at: number;
}

/** One aggregated role and name hint observed inside an authorised application scope. It is vocabulary for a fresh query, never an element handle or authority to act. */
export interface ElementDiscoveryEntry {
  /** The neutral role shared by the observed occurrences. */
  role: Role;
  /** The normalised human-facing name shared by the observed occurrences. An empty string represents unnamed elements without inventing a name. */
  name: string;
  /** The exact number of fully observed occurrences with this role and name inside the selected scope. */
  count: number;
  /** The sorted unique open-text action names exposed across the observed occurrences. */
  actions: string[];
  /** The sorted unique semantic operation names exposed across the observed occurrences. */
  operations: string[];
}

/** Native details preserved for a human debugging. Exempt from the neutral-vocabulary rule; never load-bearing for agent logic. */
export interface Diagnostic {
  /** The backend's own role word, verbatim. */
  nativeRole?: string;
  /** The backend's own identifier for the element, verbatim. */
  nativeId?: string;
}

/** The state of the machine's accessibility layer - the instrument every observation in this contract depends on. Three states for the reason availabilityState has three: disabled is a fact about the machine, cannot-tell is a fact about this daemon's view of it, and a reader told the first when the second is true goes and switches on something that was never off. A layer that is off is why a desktop full of applications reads as empty, so a caller that receives this can tell a silent machine from a bare one. Nothing here names a platform, a bus or a protocol: which mechanism answered is the thing a second platform would answer differently. */
export interface AccessibilityLayer {
  /** Whether this machine's accessibility layer is switched on. cannot-tell is never a way of saying no. */
  state: AccessibilityState;
  /** Why the state could not be determined, in words an operator can act on. Present exactly when state is cannot-tell: an ignorance with no reason is a shrug, and a reason attached to a measurement is noise. */
  reason?: string;
}

/** Where this desktop keeps a session's own files. A caller cannot see a filesystem through this contract and is not being given one: these are the few paths a desktop's applications will themselves offer - the home a file dialog opens in, the folder a browser saves into - and they are here because the alternative is a caller inventing them. An invented path produces an application's own not-found page, which reads exactly like a file that failed to save, and a caller that cannot tell those apart reports a download as broken or a save as done. Nothing here reads, writes or lists a file; the paths are the desktop's, not this daemon's, and a desktop that does not publish one omits it rather than guessing. */
export interface DesktopPlaces {
  /** The session's home directory, when the desktop publishes one. Absent rather than defaulted: a home this daemon assumed would be a guess wearing an answer's clothes. */
  home?: string;
  /** The folder this desktop's applications save downloads into, when it publishes one. Not derived from home - a desktop is free to put it elsewhere, and the deriving is the mistake this field exists to remove. */
  downloads?: string;
}

/** A picture of one part of this desktop, as bytes rather than as a description. Every other answer in this contract is what the platform SAYS about a thing; this is what the thing LOOKS like, and it exists because the saying runs out: an image on a web page routinely publishes no name and content the platform reports as not exposed, which reads to a caller exactly like a blank rectangle, and a caller with no eyes then guesses - at file names, at menu items, at whether anything happened at all. The picture is bounded by an element that this daemon has already answered for, so it is not a screen recording and not a view of a desk the caller was never shown: it is the rectangle of one named thing, read at the moment of the call. */
export interface CapturedImage {
  /** The encoding of the bytes. "png", always: one lossless format, so a caller never has to ask what it is looking at. */
  format: string;
  /** The width of the returned picture in pixels. The picture may be clipped to the captured display and need not span the full element rectangle. */
  width: number;
  /** The height of the returned picture in pixels. The picture may be clipped to the captured display and need not span the full element rectangle. */
  height: number;
  /** The image bytes, base64. Bounded by this daemon: a picture larger than its ceiling is refused rather than quietly shrunk, because a caller told an image is 4096 wide when it was resized to 512 has been given a measurement that is not true. */
  data: string;
}

/** Find elements matching a semantic query. Observation only. */
export interface QueryElementsParams {
  /** Restrict the answer to one role. */
  role?: Role;
  /** Restrict the answer to elements whose normalised name matches. */
  name?: string;
  /** Restrict the answer to one visible, authorised application whose normalised exact name matches. This selector only narrows observation and never grants authority. */
  application?: string;
  /** Restrict the answer to one visible window whose normalised exact name matches inside application. A window can only be named when application is also present. */
  window?: string;
  /** Upper bound on the number of returned elements. */
  limit?: number;
}

export interface QueryElementsResult {
  /** Every element that matched, in reading order. */
  elements: SemanticElement[];
}

/** Discover bounded semantic role and name vocabulary inside one authorised application scope. Observation only. The returned entries are hints, never element authority; use a fresh queryElements call before acting. */
export interface DiscoverElementsParams {
  /** Select one visible, authorised application whose normalised exact name matches. This scope only narrows observation and never grants authority. */
  application: string;
  /** Optionally select one visible window whose normalised exact name matches inside application. */
  window?: string;
  /** Optionally restrict the discovered vocabulary to one neutral role without changing complete traversal semantics. */
  role?: Role;
  /** Maximum number of distinct entries returned. The daemon requires an integer from 1 through 200 and defaults to 100. */
  limit?: number;
}

export interface DiscoverElementsResult {
  /** Aggregated role and name hints in deterministic order. They contain no element IDs or content and cannot be acted on directly. */
  entries: ElementDiscoveryEntry[];
  /** True only when complete traversal found more distinct entries than the returned limit. Incomplete traversal is a refusal, never truncation. */
  truncated: boolean;
}

/** State what a later call would act on, without acting. Returns the element as currently resolvable, or an explicit refusal naming why. */
export interface AttestElementParams {
  /** The element to attest. */
  id: string;
}

export interface AttestElementResult {
  /** Present when the id still resolves. */
  element?: SemanticElement;
  /** Present when it does not; names the reason. */
  refusal?: string;
}

/** Read one bounded window of an element's ordinary textual content. Observation only. The application grant is checked before resolving the element, and protected controls return structured redaction without reading their value. */
export interface ReadElementContentParams {
  /** The element whose current textual content is being read. */
  id: string;
  /** Zero-based Unicode-scalar offset at which the requested window begins. */
  offset: number;
  /** Maximum number of Unicode scalar values requested. The daemon applies its smaller fixed response bound when necessary. */
  limit: number;
}

export interface ReadElementContentResult {
  /** Present when the element resolves. Text is exact when it fits; text-window carries bounded content and navigation metadata; protected and unavailable states carry no value. */
  content?: ObservableContent;
  /** Present when scope, identity, or request bounds refuse the observation. */
  refusal?: string;
}

/** Watch one element and everything beneath it, and be told when any of it changes. Observation only: a subscription reads, and cannot cause anything to happen. Scope is the point - a watch on one subtree is the difference between being told what matters and being told everything. Defined on the wire before either route can serve it; until a route can, every call is refused by name. */
export interface SubscribeElementParams {
  /** The element to watch, together with its descendants. */
  id: string;
  /** How urgent this subscriber considers changes here. Carried on every resulting event and never interpreted by the daemon. */
  priority: Priority;
}

export interface SubscribeElementResult {
  /** Present when the watch was established. */
  subscription?: Subscription;
  /** Present otherwise; names the check that ran and what would change the answer. */
  refusal?: string;
}

/** End a watch. Observation only. Ending a watch that is already over is not an error: the answer says the watch is not running, which is the state the caller wanted either way. */
export interface UnsubscribeElementParams {
  /** The watch to end, as named when it was established. */
  subscriptionId: string;
}

export interface UnsubscribeElementResult {
  /** Present when the watch is no longer running - true when this call ended it, false when it had already ended on its own. */
  ended?: boolean;
  /** Present otherwise; names the check that ran and what would change the answer. */
  refusal?: string;
}

/** Open an application by name, with its readability applied at the moment it starts. The first effect-class method: visible to the person, trivially reversible. Authority is checked before anything else, and a refusal never reveals whether an application exists on this machine. */
export interface OpenApplicationParams {
  /** The human-facing application name. Neutral vocabulary; no platform identifiers. Comparisons normalise to NFKC first. */
  name: string;
}

export interface OpenApplicationResult {
  /** Present when the application was opened (or was already ours) and became readable. */
  application?: SemanticElement;
  /** Present otherwise; names the reason without revealing what is available to other sessions. */
  refusal?: string;
}

/** Replace a text field's content. Edit-class: changes what an element holds without committing anything beyond it. Served on the wire: the effect-class gate is enforced before the call, and a daemon not granted this capability for the application refuses by name rather than acting. */
export interface EditElementParams {
  /** The element whose content would be replaced. */
  id: string;
  /** The content the element would hold afterwards. */
  value: string;
}

export interface EditElementResult {
  /** Present when the edit was performed; the element as it reads afterwards. */
  element?: SemanticElement;
  /** Present otherwise; names the check that ran and what would change the answer. */
  refusal?: string;
}

/** Perform one advertised action on an element. Activate-class: causes the element to do the thing it exists to do. Served on the wire: the effect-class gate is enforced before the call, and a daemon not granted this capability for the application refuses by name rather than acting. */
export interface ActivateElementParams {
  /** The element the action would be performed on. */
  id: string;
  /** One of the element's advertised actions, named exactly as the element published it. A name the element did not publish is refused by name rather than attempted. */
  action: string;
}

export interface ActivateElementResult {
  /** Present when the action was performed; the element as it reads afterwards. */
  element?: SemanticElement;
  /** Present otherwise; names the check that ran and what would change the answer. */
  refusal?: string;
}

/** Commit something beyond the machine's ability to take back. Submit-class: the attestation is the machine's own restatement of what is being committed, and it is required in every call - the contract makes waiving it inexpressible. Served on the wire: the effect-class gate is enforced before the call, and a daemon not granted this capability for the application refuses by name rather than acting. */
export interface SubmitElementParams {
  /** The element that would commit. */
  id: string;
  /** The caller's own restatement of what this commit does. Never optional: a commit the caller cannot describe is refused. */
  attestation: string;
}

export interface SubmitElementResult {
  /** Present when the commit was performed; the element as it reads afterwards. */
  element?: SemanticElement;
  /** Present otherwise; names the check that ran and what would change the answer. */
  refusal?: string;
}

/** Move an element's magnitude to a value inside the range that element published. Edit-class. The value is expressed in the element's own units, because the only units that mean anything are the ones the element declared; a magnitude outside the published range is refused before the call rather than clamped into a lie. Served on the wire: the effect-class gate is enforced before the call, and a daemon not granted this capability for the application refuses by name rather than acting. */
export interface SetElementValueParams {
  /** The element whose magnitude would move. */
  id: string;
  /** The value the element would hold afterwards, in the units of the range the element itself published. */
  value: number;
}

export interface SetElementValueResult {
  /** Present when the operation was performed; the element as it reads afterwards, re-read rather than echoed. */
  element?: SemanticElement;
  /** Present otherwise; names the check that ran and what would change the answer. */
  refusal?: string;
}

/** Replace an element's text, or insert text at an offset within it. Edit-class, and distinct from replacing a whole field: an offset is a position in the element's own text, counted the way the element counts it. Served on the wire: the effect-class gate is enforced before the call, and a daemon not granted this capability for the application refuses by name rather than acting. */
export interface SetElementTextParams {
  /** The element whose text would change. */
  id: string;
  /** The text to place. */
  text: string;
  /** Where to insert, in the element's own offsets. Absent replaces the whole content. An offset beyond the element's text is refused rather than silently moved to the end, because a write that lands somewhere other than where it was aimed is a wrong write that returned success. */
  offset?: number;
}

export interface SetElementTextResult {
  /** Present when the operation was performed; the element as it reads afterwards, re-read rather than echoed. */
  element?: SemanticElement;
  /** Present otherwise; names the check that ran and what would change the answer. */
  refusal?: string;
}

/** Place the insertion point within an element's text. Edit-class: it changes where the next write would land and commits nothing. Served on the wire: the effect-class gate is enforced before the call, and a daemon not granted this capability for the application refuses by name rather than acting. */
export interface SetElementCaretParams {
  /** The element whose insertion point would move. */
  id: string;
  /** Where to place it, in the element's own offsets. Absent places it at the end of the element's text. */
  offset?: number;
}

export interface SetElementCaretResult {
  /** Present when the operation was performed; the element as it reads afterwards, re-read rather than echoed. */
  element?: SemanticElement;
  /** Present otherwise; names the check that ran and what would change the answer. */
  refusal?: string;
}

/** Bring an element into view. Activate-class: the neutral form is make this visible, and it is deliberately not a distance, a direction, or a coordinate - a scroll expressed in pixels is a promise about one machine's geometry that no other machine can keep. Whether the surface scrolls, pages, or expands to satisfy it belongs to the platform underneath. Served on the wire: the effect-class gate is enforced before the call, and a daemon not granted this capability for the application refuses by name rather than acting. */
export interface RevealElementParams {
  /** The element to bring into view. */
  id: string;
}

export interface RevealElementResult {
  /** Present when the operation was performed; the element as it reads afterwards, re-read so a reveal that changed nothing is reported as one rather than assumed to have worked. */
  element?: SemanticElement;
  /** Present otherwise; names the check that ran and what would change the answer. */
  refusal?: string;
}

/** List the applications this machine has, each with what may be done with it and the setting behind every refusal. Observation only, and observation of the fence rather than of anything behind it: an application this session may not touch is present here with its capabilities off and their settings named. Withholding its existence would teach a reader it is absent, and a reader who believes that recommends installing what is already installed. Each entry also says whether the application is answering the machine's accessibility layer RIGHT NOW, so a caller can tell an application that is merely installed from one that is already open in front of the user - the difference between opening a second copy and walking up to the one that is there. How the inventory is discovered belongs to the platform underneath, which is why nothing in this result names a mechanism. */
export interface ListApplicationsParams {
}

export interface ListApplicationsResult {
  /** Present when the inventory could be read; every application found, permitted or not. */
  applications?: InstalledApplication[];
  /** Present otherwise; names the check that ran and what would change the answer. */
  refusal?: string;
}

/** Ask whether this machine can be heard at all. Observation only, and of the instrument rather than of any desktop behind it: when the accessibility layer is off, every other observation in this contract returns empty, which is indistinguishable from a machine with nothing running on it. A caller that reads an empty result without asking this forms exactly the false belief the rest of the contract is built to prevent. Answering carries no risk and needs no permission - it reports the daemon's own instrument, never anything an application published. */
export interface DescribeAccessibilityParams {
}

export interface DescribeAccessibilityResult {
  /** The layer's state, and a reason when it could not be determined. */
  accessibility: AccessibilityLayer;
}

/** Ask the daemon to switch this machine's accessibility layer on. This changes the operator's machine rather than an application's contents, so it is off unless the operator started the daemon with the flag that permits it, and no request can turn that flag on - a session cannot grant itself the authority to reconfigure the machine it is running on. A daemon without the flag refuses and names it. A platform this build has no adapter for refuses differently, because no setting would change that answer. */
export interface AcquireAccessibilityParams {
}

export interface AcquireAccessibilityResult {
  /** Present when the attempt ran; the layer's state as read back AFTER the attempt, never the state that was asked for. An acquire that reports success without re-reading is reporting its own intention. */
  accessibility?: AccessibilityLayer;
  /** Present otherwise; names the check that ran and what would change the answer - the flag when the operator withheld it, and the missing adapter when no setting would help. */
  refusal?: string;
}

/** Close a running application and start it again. This ends a program the person may be using, so it is refused unless the operator configured a level that acts, and the refusal names the setting. At the graceful level the application is asked to close and is allowed to say no: an unsaved-work dialog outranks the caller, is reported as an element to read, and leaves the application running. Nothing here dismisses such a dialog. The outcome is read back from the desktop rather than taken from an exit status. */
export interface RestartApplicationParams {
  /** The human-facing application name, as listApplications reports it. Comparisons normalise to NFKC first. */
  name: string;
}

export interface RestartApplicationResult {
  /** Present when the application was closed and started again, and became readable; the application as it reads afterwards. */
  application?: SemanticElement;
  /** Present when the application refused to close and put something up instead - typically an unsaved-work dialog. The element is reported so a person can be shown it or an agent can read it; the application is still running, and this daemon did not touch the dialog. */
  blockedBy?: SemanticElement;
  /** Present otherwise; names the check that ran and what would change the answer - the restart setting when configuration withheld it, the level that would act when the operator chose to be asked each time, and what was observed when the application neither closed nor put anything up. */
  refusal?: string;
}

/** Deliver one named key chord to one element. This is RAW INPUT, not an operation: the four operations describe what an element is for and are answered by the element itself, while a key is delivered to whatever the machine is pointing at and the element is only how it is aimed. It is therefore its own capability, off unless a person switched it on, and it is never reached by a failed operation retrying - nothing in this daemon falls back to a keystroke. The chord must be one of the names this contract lists; anything else is refused by name rather than attempted. The outcome is read back from the desktop, because a key emission's return code says only that something was sent, never where it landed. */
export interface SendKeyChordParams {
  /** The element the chord is aimed at. It is focused first, and the focus that was there before is put back afterwards; a focus that could not be put back is reported rather than passed over. */
  id: string;
  /** One of the named chords this contract defines. The list is closed on purpose: a free-form key string is an arbitrary-input surface wearing a chord's clothes, and this class is the most restricted one the contract has. */
  chord: KeyChordName;
}

export interface SendKeyChordResult {
  /** Present when the chord was delivered; the element as it reads AFTERWARDS, read back from the desktop. It is evidence of what the element became, never a claim that the key did what the caller hoped - the caller compares it against what it expected. */
  element?: SemanticElement;
  /** Present otherwise; names the check that ran and what would change the answer - the session flag or the configuration key when this capability is switched off, the chord vocabulary when the name is not one of them, and what was observed when the element could not be focused or the machine has no way to deliver a key at all. */
  refusal?: string;
}

/** Deliver a run of printable text to one element by typing it, one keystroke at a time, into whatever the machine is pointing at. This is RAW INPUT in the same class as sendKeyChord, and it exists for one reason: some fields publish a value to read but no interface to set it, so the only way through the machine's own accessibility layer is the keyboard. It is off unless a person switched it on, it is never reached by a failed setElementValue or setElementText retrying - nothing in this daemon falls back to typing - and a caller is expected to have been REFUSED by the element's own operation first, then to type, then to read the element back and compare. The text is printable only: a newline, a tab or an escape is refused by name, because those are chords (sendKeyChord) and a string that could carry them would be a chord vocabulary with no list. The outcome is read back from the desktop, because a key emission's return code says only that something was sent, never where it landed. */
export interface TypeTextParams {
  /** The element the text is aimed at. It is focused first, and the focus that was there before is put back afterwards; a focus that could not be put back is reported rather than passed over. */
  id: string;
  /** The printable text to type, at most 1024 UTF-16 code units, containing no control characters or unpaired surrogates. Supplementary characters occupy two units; combining sequences are not counted as one grapheme. Valid text is not normalized. It is delivered as keystrokes, so it lands wherever the machine's focus is; the element is how it is aimed, not a guarantee of where it arrives. */
  text: string;
}

export interface TypeTextResult {
  /** Present after input emission was attempted; the element as it reads AFTERWARDS. Delivery and the intended value remain unverified without trustworthy caret, selection and timing evidence. Length growth alone proves neither arrival nor failure. Observe before deciding whether to retry; never automatically resend or clear text following an uncertain attempt. */
  element?: SemanticElement;
  /** Present otherwise; names the check that ran and what would change the answer - the session flag or the configuration key when this capability is switched off, the character or the length when the text is not printable or too long, and what was observed when the element could not be focused or the machine has no way to deliver a key at all. */
  refusal?: string;
}

/** Empty one element's text by keystroke, so that a subsequent typeText writes a field instead of extending it. This is RAW INPUT in the same class as sendKeyChord and typeText, and it exists because typing is an APPEND: a field that publishes a value to read but no interface to set it can be typed into and cannot be replaced, and pressing a named chord once per character is the only vocabulary this contract has. It is off unless a person switched it on, it is never reached by a failed setElementValue or setElementText retrying, and it presses nothing it cannot count: the element's own published text says how many characters are there, the presses are bounded by that reading, and an element whose text this daemon cannot read is refused rather than cleared blind. The outcome is read back from the desktop and COMPARED - an element that is not empty afterwards is a refusal, never a success with a disappointing element attached. */
export interface ClearElementTextParams {
  /** The element to empty. It is focused first, and the focus that was there before is put back afterwards; a focus that could not be put back is reported rather than passed over. */
  id: string;
}

export interface ClearElementTextResult {
  /** Present when the element read back empty; the element as it reads AFTERWARDS, read back from the desktop. An element that still carries text is reported as a refusal instead, because the whole point of this method is the comparison. */
  element?: SemanticElement;
  /** Present otherwise; names the check that ran and what would change the answer - the session flag or the configuration key when this capability is switched off, the reason the element's text could not be read, the length when there is more text than this method will press through, and what was observed when the element did not come back empty. */
  refusal?: string;
}

/** Press a pointer button inside one element that this daemon has already answered for. This is a POINTER, and it is deliberately not a free one: there is no method here that takes a screen coordinate, because a coordinate names a place on a screen rather than a thing on a desk, and a daemon that clicked places could not say afterwards what it had clicked. What this method takes is an ELEMENT and, optionally, a position INSIDE that element expressed as a fraction of its own rectangle, which the daemon turns into a screen point from the bounds the platform publishes for it. It exists because a published action is not always offered: a grid of images, a canvas, a map and a custom widget can all be seen, named and bounded while publishing nothing to activate, and an agent that can only activate what advertises itself has one road that can fail rather than several that can succeed. An element the platform gives no bounds for, or that is off screen, or that is not visible, is refused rather than guessed at, and the outcome is read back from the desktop afterwards like every other effect in this contract. */
export interface ClickElementParams {
  /** The element to press inside. Its rectangle is read from the platform at the moment of the call, never remembered from an earlier answer, because a remembered rectangle is a click aimed at where something used to be. */
  id: string;
  /** Which pointer button: "left", "middle" or "right". Defaults to "left". A name this contract never defined is refused by name rather than mapped to something near it. */
  button?: string;
  /** How many presses in one gesture: the daemon accepts 1 or 2 and defaults to 1, so that a double click is asked for by name rather than assembled by a caller sending two clicks and hoping the platform joins them. */
  count?: number;
  /** Where inside the element to press, horizontally, as a fraction of its own width from its left edge. Defaults to 0.5, the centre. Refused outside 0 through 1, because a fraction outside the element is a click on a neighbour. */
  x?: number;
  /** Where inside the element to press, vertically, as a fraction of its own height from its top edge. Defaults to 0.5, the centre. Refused outside 0 through 1 for the same reason. */
  y?: number;
}

export interface ClickElementResult {
  /** Present when the press was delivered; the element as it reads AFTERWARDS, read back from the desktop. A pointer press is not aimed at an element the way a semantic action is - it is aimed at a point that was inside the element when the bounds were read - so this element is evidence to compare against what was expected, not a claim that the click did what the caller wanted. */
  element?: SemanticElement;
  /** Present otherwise; names the check that ran and what would change the answer - the effect class this session was not granted, the missing pointer route on a build that has none, the button or count or fraction that was not in this contract's vocabulary, and the reason the element could not be aimed at: no bounds published, an empty rectangle, or a rectangle that is off the screen. */
  refusal?: string;
}

/** Ask this desktop where its own files live. Observation only, and of the machine rather than of anything an application published: no file is read, listed or opened, and nothing here is per-application, so there is no capability it could belong to. It exists because every other verb in this contract is about what is ON the screen, and a caller that must name a path has nowhere else to learn one - so it uses the home directory of whatever machine it was trained on, and a desk whose home is somewhere else answers with a not-found page that a caller reads as a failed save. Answering carries no risk: these paths are already visible in any file dialog the caller is permitted to open. */
export interface DescribeDesktopParams {
}

export interface DescribeDesktopResult {
  /** The paths this desktop publishes, each omitted when it publishes none. */
  places: DesktopPlaces;
}

/** Look at what one element LOOKS like: a picture of its rectangle, cropped from the pixels the desktop is showing. Observation, and the narrowest kind - no coordinate crosses the wire in either direction, exactly as with the pointer (ADR-0079): the caller names an ELEMENT it has already been answered for, and the rectangle is read from the platform at the moment of the grab. It exists because the semantic answers this contract is built on can run out while the thing is plainly there to a person: a logo, a chart, a map, a canvas, a rendered document and a grid of thumbnails can all be named, bounded and pressed while publishing neither name nor content, and a caller that can only read labels then invents what it cannot see. A window is an element too, so this reaches from one button up to a whole application's window. The image contains currently visible pixels in the intersection of the element rectangle and the captured display, so it may be clipped. Overlapping windows may appear; capture does not prove application ownership of those pixels. Capture does not raise, focus, scroll or click. If foreground preparation is necessary, use an observed and permitted window-navigation action, then reobserve the target and its geometry before capturing again. Foreground preparation is best effort, not proof of non-occlusion or an atomic focus-and-capture operation. Native capture refuses partial display intersections until crop provenance is available (ADR-0102); bring the entire element onto the display and reobserve. Never infer a crop offset from PNG dimensions or map a partial image location directly to element-relative clicks. A complete image is still not a freshness or non-occlusion guarantee. */
export interface CaptureElementParams {
  /** The element to look at. Its rectangle is read from the platform at the moment of the call, never remembered from an earlier answer, because a remembered rectangle is a picture of where something used to be. */
  id: string;
}

export interface CaptureElementResult {
  /** Present when the picture was taken; currently visible pixels intersecting the element rectangle and captured display, possibly clipped or covered by other windows. */
  image?: CapturedImage;
  /** Present otherwise; names the check that ran and what would change the answer - an element the platform gives no bounds for, one that is off screen, a desk with no way to grab its own pixels, or a picture past this daemon's ceiling. */
  refusal?: string;
}

/** Each method's description and a JSON Schema for its parameters, generated from the same schema the types come from. */
export const METHOD_DESCRIPTORS: Record<MethodName, { description: string; params: Record<string, unknown> }> = {
  "queryElements": {
    "description": "Find elements matching a semantic query. Observation only.",
    "params": {
      "type": "object",
      "properties": {
        "role": {
          "description": "Restrict the answer to one role.",
          "type": "string",
          "enum": [
            "application",
            "window",
            "dialog",
            "button",
            "checkbox",
            "label",
            "link",
            "list",
            "listitem",
            "grid",
            "row",
            "gridcell",
            "menu",
            "menuitem",
            "text",
            "textbox",
            "image",
            "generic"
          ]
        },
        "name": {
          "description": "Restrict the answer to elements whose normalised name matches.",
          "type": "string"
        },
        "application": {
          "description": "Restrict the answer to one visible, authorised application whose normalised exact name matches. This selector only narrows observation and never grants authority.",
          "type": "string"
        },
        "window": {
          "description": "Restrict the answer to one visible window whose normalised exact name matches inside application. A window can only be named when application is also present.",
          "type": "string"
        },
        "limit": {
          "description": "Upper bound on the number of returned elements.",
          "type": "number"
        }
      },
      "required": [],
      "additionalProperties": false
    }
  },
  "discoverElements": {
    "description": "Discover bounded semantic role and name vocabulary inside one authorised application scope. Observation only. The returned entries are hints, never element authority; use a fresh queryElements call before acting.",
    "params": {
      "type": "object",
      "properties": {
        "application": {
          "description": "Select one visible, authorised application whose normalised exact name matches. This scope only narrows observation and never grants authority.",
          "type": "string"
        },
        "window": {
          "description": "Optionally select one visible window whose normalised exact name matches inside application.",
          "type": "string"
        },
        "role": {
          "description": "Optionally restrict the discovered vocabulary to one neutral role without changing complete traversal semantics.",
          "type": "string",
          "enum": [
            "application",
            "window",
            "dialog",
            "button",
            "checkbox",
            "label",
            "link",
            "list",
            "listitem",
            "grid",
            "row",
            "gridcell",
            "menu",
            "menuitem",
            "text",
            "textbox",
            "image",
            "generic"
          ]
        },
        "limit": {
          "description": "Maximum number of distinct entries returned. The daemon requires an integer from 1 through 200 and defaults to 100.",
          "type": "number"
        }
      },
      "required": [
        "application"
      ],
      "additionalProperties": false
    }
  },
  "attestElement": {
    "description": "State what a later call would act on, without acting. Returns the element as currently resolvable, or an explicit refusal naming why.",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "description": "The element to attest.",
          "type": "string",
          "pattern": "^(el|win|app)-[0-9a-f]{12}$"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  "readElementContent": {
    "description": "Read one bounded window of an element's ordinary textual content. Observation only. The application grant is checked before resolving the element, and protected controls return structured redaction without reading their value.",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "description": "The element whose current textual content is being read.",
          "type": "string",
          "pattern": "^(el|win|app)-[0-9a-f]{12}$"
        },
        "offset": {
          "description": "Zero-based Unicode-scalar offset at which the requested window begins.",
          "type": "number"
        },
        "limit": {
          "description": "Maximum number of Unicode scalar values requested. The daemon applies its smaller fixed response bound when necessary.",
          "type": "number"
        }
      },
      "required": [
        "id",
        "offset",
        "limit"
      ],
      "additionalProperties": false
    }
  },
  "subscribeElement": {
    "description": "Watch one element and everything beneath it, and be told when any of it changes. Observation only: a subscription reads, and cannot cause anything to happen. Scope is the point - a watch on one subtree is the difference between being told what matters and being told everything. Defined on the wire before either route can serve it; until a route can, every call is refused by name.",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "description": "The element to watch, together with its descendants.",
          "type": "string",
          "pattern": "^(el|win|app)-[0-9a-f]{12}$"
        },
        "priority": {
          "description": "How urgent this subscriber considers changes here. Carried on every resulting event and never interpreted by the daemon.",
          "type": "string",
          "enum": [
            "low",
            "medium",
            "high"
          ]
        }
      },
      "required": [
        "id",
        "priority"
      ],
      "additionalProperties": false
    }
  },
  "unsubscribeElement": {
    "description": "End a watch. Observation only. Ending a watch that is already over is not an error: the answer says the watch is not running, which is the state the caller wanted either way.",
    "params": {
      "type": "object",
      "properties": {
        "subscriptionId": {
          "description": "The watch to end, as named when it was established.",
          "type": "string"
        }
      },
      "required": [
        "subscriptionId"
      ],
      "additionalProperties": false
    }
  },
  "openApplication": {
    "description": "Open an application by name, with its readability applied at the moment it starts. The first effect-class method: visible to the person, trivially reversible. Authority is checked before anything else, and a refusal never reveals whether an application exists on this machine.",
    "params": {
      "type": "object",
      "properties": {
        "name": {
          "description": "The human-facing application name. Neutral vocabulary; no platform identifiers. Comparisons normalise to NFKC first.",
          "type": "string"
        }
      },
      "required": [
        "name"
      ],
      "additionalProperties": false
    }
  },
  "editElement": {
    "description": "Replace a text field's content. Edit-class: changes what an element holds without committing anything beyond it. Served on the wire: the effect-class gate is enforced before the call, and a daemon not granted this capability for the application refuses by name rather than acting.",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "description": "The element whose content would be replaced.",
          "type": "string",
          "pattern": "^(el|win|app)-[0-9a-f]{12}$"
        },
        "value": {
          "description": "The content the element would hold afterwards.",
          "type": "string"
        }
      },
      "required": [
        "id",
        "value"
      ],
      "additionalProperties": false
    }
  },
  "activateElement": {
    "description": "Perform one advertised action on an element. Activate-class: causes the element to do the thing it exists to do. Served on the wire: the effect-class gate is enforced before the call, and a daemon not granted this capability for the application refuses by name rather than acting.",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "description": "The element the action would be performed on.",
          "type": "string",
          "pattern": "^(el|win|app)-[0-9a-f]{12}$"
        },
        "action": {
          "description": "One of the element's advertised actions, named exactly as the element published it. A name the element did not publish is refused by name rather than attempted.",
          "type": "string"
        }
      },
      "required": [
        "id",
        "action"
      ],
      "additionalProperties": false
    }
  },
  "submitElement": {
    "description": "Commit something beyond the machine's ability to take back. Submit-class: the attestation is the machine's own restatement of what is being committed, and it is required in every call - the contract makes waiving it inexpressible. Served on the wire: the effect-class gate is enforced before the call, and a daemon not granted this capability for the application refuses by name rather than acting.",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "description": "The element that would commit.",
          "type": "string",
          "pattern": "^(el|win|app)-[0-9a-f]{12}$"
        },
        "attestation": {
          "description": "The caller's own restatement of what this commit does. Never optional: a commit the caller cannot describe is refused.",
          "type": "string"
        }
      },
      "required": [
        "id",
        "attestation"
      ],
      "additionalProperties": false
    }
  },
  "setElementValue": {
    "description": "Move an element's magnitude to a value inside the range that element published. Edit-class. The value is expressed in the element's own units, because the only units that mean anything are the ones the element declared; a magnitude outside the published range is refused before the call rather than clamped into a lie. Served on the wire: the effect-class gate is enforced before the call, and a daemon not granted this capability for the application refuses by name rather than acting.",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "description": "The element whose magnitude would move.",
          "type": "string",
          "pattern": "^(el|win|app)-[0-9a-f]{12}$"
        },
        "value": {
          "description": "The value the element would hold afterwards, in the units of the range the element itself published.",
          "type": "number"
        }
      },
      "required": [
        "id",
        "value"
      ],
      "additionalProperties": false
    }
  },
  "setElementText": {
    "description": "Replace an element's text, or insert text at an offset within it. Edit-class, and distinct from replacing a whole field: an offset is a position in the element's own text, counted the way the element counts it. Served on the wire: the effect-class gate is enforced before the call, and a daemon not granted this capability for the application refuses by name rather than acting.",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "description": "The element whose text would change.",
          "type": "string",
          "pattern": "^(el|win|app)-[0-9a-f]{12}$"
        },
        "text": {
          "description": "The text to place.",
          "type": "string"
        },
        "offset": {
          "description": "Where to insert, in the element's own offsets. Absent replaces the whole content. An offset beyond the element's text is refused rather than silently moved to the end, because a write that lands somewhere other than where it was aimed is a wrong write that returned success.",
          "type": "number"
        }
      },
      "required": [
        "id",
        "text"
      ],
      "additionalProperties": false
    }
  },
  "setElementCaret": {
    "description": "Place the insertion point within an element's text. Edit-class: it changes where the next write would land and commits nothing. Served on the wire: the effect-class gate is enforced before the call, and a daemon not granted this capability for the application refuses by name rather than acting.",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "description": "The element whose insertion point would move.",
          "type": "string",
          "pattern": "^(el|win|app)-[0-9a-f]{12}$"
        },
        "offset": {
          "description": "Where to place it, in the element's own offsets. Absent places it at the end of the element's text.",
          "type": "number"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  "revealElement": {
    "description": "Bring an element into view. Activate-class: the neutral form is make this visible, and it is deliberately not a distance, a direction, or a coordinate - a scroll expressed in pixels is a promise about one machine's geometry that no other machine can keep. Whether the surface scrolls, pages, or expands to satisfy it belongs to the platform underneath. Served on the wire: the effect-class gate is enforced before the call, and a daemon not granted this capability for the application refuses by name rather than acting.",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "description": "The element to bring into view.",
          "type": "string",
          "pattern": "^(el|win|app)-[0-9a-f]{12}$"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  "listApplications": {
    "description": "List the applications this machine has, each with what may be done with it and the setting behind every refusal. Observation only, and observation of the fence rather than of anything behind it: an application this session may not touch is present here with its capabilities off and their settings named. Withholding its existence would teach a reader it is absent, and a reader who believes that recommends installing what is already installed. Each entry also says whether the application is answering the machine's accessibility layer RIGHT NOW, so a caller can tell an application that is merely installed from one that is already open in front of the user - the difference between opening a second copy and walking up to the one that is there. How the inventory is discovered belongs to the platform underneath, which is why nothing in this result names a mechanism.",
    "params": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    }
  },
  "describeAccessibility": {
    "description": "Ask whether this machine can be heard at all. Observation only, and of the instrument rather than of any desktop behind it: when the accessibility layer is off, every other observation in this contract returns empty, which is indistinguishable from a machine with nothing running on it. A caller that reads an empty result without asking this forms exactly the false belief the rest of the contract is built to prevent. Answering carries no risk and needs no permission - it reports the daemon's own instrument, never anything an application published.",
    "params": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    }
  },
  "acquireAccessibility": {
    "description": "Ask the daemon to switch this machine's accessibility layer on. This changes the operator's machine rather than an application's contents, so it is off unless the operator started the daemon with the flag that permits it, and no request can turn that flag on - a session cannot grant itself the authority to reconfigure the machine it is running on. A daemon without the flag refuses and names it. A platform this build has no adapter for refuses differently, because no setting would change that answer.",
    "params": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    }
  },
  "restartApplication": {
    "description": "Close a running application and start it again. This ends a program the person may be using, so it is refused unless the operator configured a level that acts, and the refusal names the setting. At the graceful level the application is asked to close and is allowed to say no: an unsaved-work dialog outranks the caller, is reported as an element to read, and leaves the application running. Nothing here dismisses such a dialog. The outcome is read back from the desktop rather than taken from an exit status.",
    "params": {
      "type": "object",
      "properties": {
        "name": {
          "description": "The human-facing application name, as listApplications reports it. Comparisons normalise to NFKC first.",
          "type": "string"
        }
      },
      "required": [
        "name"
      ],
      "additionalProperties": false
    }
  },
  "sendKeyChord": {
    "description": "Deliver one named key chord to one element. This is RAW INPUT, not an operation: the four operations describe what an element is for and are answered by the element itself, while a key is delivered to whatever the machine is pointing at and the element is only how it is aimed. It is therefore its own capability, off unless a person switched it on, and it is never reached by a failed operation retrying - nothing in this daemon falls back to a keystroke. The chord must be one of the names this contract lists; anything else is refused by name rather than attempted. The outcome is read back from the desktop, because a key emission's return code says only that something was sent, never where it landed.",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "description": "The element the chord is aimed at. It is focused first, and the focus that was there before is put back afterwards; a focus that could not be put back is reported rather than passed over.",
          "type": "string",
          "pattern": "^(el|win|app)-[0-9a-f]{12}$"
        },
        "chord": {
          "description": "One of the named chords this contract defines. The list is closed on purpose: a free-form key string is an arbitrary-input surface wearing a chord's clothes, and this class is the most restricted one the contract has.",
          "type": "string",
          "enum": [
            "Enter",
            "Escape",
            "Tab",
            "Backspace",
            "Delete",
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "Home",
            "End",
            "PageUp",
            "PageDown",
            "F2"
          ]
        }
      },
      "required": [
        "id",
        "chord"
      ],
      "additionalProperties": false
    }
  },
  "typeText": {
    "description": "Deliver a run of printable text to one element by typing it, one keystroke at a time, into whatever the machine is pointing at. This is RAW INPUT in the same class as sendKeyChord, and it exists for one reason: some fields publish a value to read but no interface to set it, so the only way through the machine's own accessibility layer is the keyboard. It is off unless a person switched it on, it is never reached by a failed setElementValue or setElementText retrying - nothing in this daemon falls back to typing - and a caller is expected to have been REFUSED by the element's own operation first, then to type, then to read the element back and compare. The text is printable only: a newline, a tab or an escape is refused by name, because those are chords (sendKeyChord) and a string that could carry them would be a chord vocabulary with no list. The outcome is read back from the desktop, because a key emission's return code says only that something was sent, never where it landed.",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "description": "The element the text is aimed at. It is focused first, and the focus that was there before is put back afterwards; a focus that could not be put back is reported rather than passed over.",
          "type": "string",
          "pattern": "^(el|win|app)-[0-9a-f]{12}$"
        },
        "text": {
          "description": "The printable text to type, at most 1024 UTF-16 code units, containing no control characters or unpaired surrogates. Supplementary characters occupy two units; combining sequences are not counted as one grapheme. Valid text is not normalized. It is delivered as keystrokes, so it lands wherever the machine's focus is; the element is how it is aimed, not a guarantee of where it arrives.",
          "type": "string"
        }
      },
      "required": [
        "id",
        "text"
      ],
      "additionalProperties": false
    }
  },
  "clearElementText": {
    "description": "Empty one element's text by keystroke, so that a subsequent typeText writes a field instead of extending it. This is RAW INPUT in the same class as sendKeyChord and typeText, and it exists because typing is an APPEND: a field that publishes a value to read but no interface to set it can be typed into and cannot be replaced, and pressing a named chord once per character is the only vocabulary this contract has. It is off unless a person switched it on, it is never reached by a failed setElementValue or setElementText retrying, and it presses nothing it cannot count: the element's own published text says how many characters are there, the presses are bounded by that reading, and an element whose text this daemon cannot read is refused rather than cleared blind. The outcome is read back from the desktop and COMPARED - an element that is not empty afterwards is a refusal, never a success with a disappointing element attached.",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "description": "The element to empty. It is focused first, and the focus that was there before is put back afterwards; a focus that could not be put back is reported rather than passed over.",
          "type": "string",
          "pattern": "^(el|win|app)-[0-9a-f]{12}$"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  "clickElement": {
    "description": "Press a pointer button inside one element that this daemon has already answered for. This is a POINTER, and it is deliberately not a free one: there is no method here that takes a screen coordinate, because a coordinate names a place on a screen rather than a thing on a desk, and a daemon that clicked places could not say afterwards what it had clicked. What this method takes is an ELEMENT and, optionally, a position INSIDE that element expressed as a fraction of its own rectangle, which the daemon turns into a screen point from the bounds the platform publishes for it. It exists because a published action is not always offered: a grid of images, a canvas, a map and a custom widget can all be seen, named and bounded while publishing nothing to activate, and an agent that can only activate what advertises itself has one road that can fail rather than several that can succeed. An element the platform gives no bounds for, or that is off screen, or that is not visible, is refused rather than guessed at, and the outcome is read back from the desktop afterwards like every other effect in this contract.",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "description": "The element to press inside. Its rectangle is read from the platform at the moment of the call, never remembered from an earlier answer, because a remembered rectangle is a click aimed at where something used to be.",
          "type": "string",
          "pattern": "^(el|win|app)-[0-9a-f]{12}$"
        },
        "button": {
          "description": "Which pointer button: \"left\", \"middle\" or \"right\". Defaults to \"left\". A name this contract never defined is refused by name rather than mapped to something near it.",
          "type": "string"
        },
        "count": {
          "description": "How many presses in one gesture: the daemon accepts 1 or 2 and defaults to 1, so that a double click is asked for by name rather than assembled by a caller sending two clicks and hoping the platform joins them.",
          "type": "number"
        },
        "x": {
          "description": "Where inside the element to press, horizontally, as a fraction of its own width from its left edge. Defaults to 0.5, the centre. Refused outside 0 through 1, because a fraction outside the element is a click on a neighbour.",
          "type": "number"
        },
        "y": {
          "description": "Where inside the element to press, vertically, as a fraction of its own height from its top edge. Defaults to 0.5, the centre. Refused outside 0 through 1 for the same reason.",
          "type": "number"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  "describeDesktop": {
    "description": "Ask this desktop where its own files live. Observation only, and of the machine rather than of anything an application published: no file is read, listed or opened, and nothing here is per-application, so there is no capability it could belong to. It exists because every other verb in this contract is about what is ON the screen, and a caller that must name a path has nowhere else to learn one - so it uses the home directory of whatever machine it was trained on, and a desk whose home is somewhere else answers with a not-found page that a caller reads as a failed save. Answering carries no risk: these paths are already visible in any file dialog the caller is permitted to open.",
    "params": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    }
  },
  "captureElement": {
    "description": "Look at what one element LOOKS like: a picture of its rectangle, cropped from the pixels the desktop is showing. Observation, and the narrowest kind - no coordinate crosses the wire in either direction, exactly as with the pointer (ADR-0079): the caller names an ELEMENT it has already been answered for, and the rectangle is read from the platform at the moment of the grab. It exists because the semantic answers this contract is built on can run out while the thing is plainly there to a person: a logo, a chart, a map, a canvas, a rendered document and a grid of thumbnails can all be named, bounded and pressed while publishing neither name nor content, and a caller that can only read labels then invents what it cannot see. A window is an element too, so this reaches from one button up to a whole application's window. The image contains currently visible pixels in the intersection of the element rectangle and the captured display, so it may be clipped. Overlapping windows may appear; capture does not prove application ownership of those pixels. Capture does not raise, focus, scroll or click. If foreground preparation is necessary, use an observed and permitted window-navigation action, then reobserve the target and its geometry before capturing again. Foreground preparation is best effort, not proof of non-occlusion or an atomic focus-and-capture operation. Native capture refuses partial display intersections until crop provenance is available (ADR-0102); bring the entire element onto the display and reobserve. Never infer a crop offset from PNG dimensions or map a partial image location directly to element-relative clicks. A complete image is still not a freshness or non-occlusion guarantee.",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "description": "The element to look at. Its rectangle is read from the platform at the moment of the call, never remembered from an earlier answer, because a remembered rectangle is a picture of where something used to be.",
          "type": "string",
          "pattern": "^(el|win|app)-[0-9a-f]{12}$"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  }
};

const TYPE_SPECS = {"semanticElement":{"fields":{"id":{"type":"string","literal":null,"literals":null,"required":true,"pattern":"idPattern"},"role":{"type":"role","literal":null,"literals":null,"required":true,"pattern":null},"name":{"type":"string","literal":null,"literals":null,"required":true,"pattern":null},"states":{"type":"state[]","literal":null,"literals":null,"required":true,"pattern":null},"actions":{"type":"action[]","literal":null,"literals":null,"required":true,"pattern":null},"operations":{"type":"operation[]","literal":null,"literals":null,"required":false,"pattern":null},"content":{"type":"observableContent","literal":null,"literals":null,"required":true,"pattern":null},"labelObservation":{"type":"labelObservation","literal":null,"literals":null,"required":false,"pattern":null},"compositeObservation":{"type":"compositeObservation","literal":null,"literals":null,"required":false,"pattern":null},"diagnostic":{"type":"diagnostic","literal":null,"literals":null,"required":false,"pattern":null}},"variants":null},"labelObservation":{"fields":null,"variants":[{"name":"available","fields":{"kind":{"type":null,"literal":"available","literals":null,"required":true,"pattern":null},"labels":{"type":"string[]","literal":null,"literals":null,"required":true,"pattern":null}}},{"name":"unavailable","fields":{"kind":{"type":null,"literal":"unavailable","literals":null,"required":true,"pattern":null},"reason":{"type":null,"literal":null,"literals":["not-exposed","unreadable","out-of-scope","limit-exceeded"],"required":true,"pattern":null}}}]},"compositeObservation":{"fields":null,"variants":[{"name":"available","fields":{"kind":{"type":null,"literal":"available","literals":null,"required":true,"pattern":null},"provenance":{"type":null,"literal":"immediate-combo-parent","literals":null,"required":true,"pattern":null},"parentRole":{"type":null,"literal":"combo box","literals":null,"required":true,"pattern":null},"relation":{"type":null,"literal":"labelled-by","literals":null,"required":true,"pattern":null},"label":{"type":"string","literal":null,"literals":null,"required":true,"pattern":null},"immediateChildCount":{"type":null,"literal":2,"literals":null,"required":true,"pattern":null},"editableChildCount":{"type":null,"literal":1,"literals":null,"required":true,"pattern":null},"siblingRole":{"type":null,"literal":"menu","literals":null,"required":true,"pattern":null}}},{"name":"unavailable","fields":{"kind":{"type":null,"literal":"unavailable","literals":null,"required":true,"pattern":null},"reason":{"type":null,"literal":null,"literals":["not-exposed","ambiguous","out-of-scope","unreadable","limit-exceeded"],"required":true,"pattern":null}}}]},"observableContent":{"fields":null,"variants":[{"name":"text","fields":{"kind":{"type":null,"literal":"text","literals":null,"required":true,"pattern":null},"value":{"type":"string","literal":null,"literals":null,"required":true,"pattern":null}}},{"name":"text-window","fields":{"kind":{"type":null,"literal":"text-window","literals":null,"required":true,"pattern":null},"value":{"type":"string","literal":null,"literals":null,"required":true,"pattern":null},"offset":{"type":"number","literal":null,"literals":null,"required":true,"pattern":null},"length":{"type":"number","literal":null,"literals":null,"required":true,"pattern":null},"totalLength":{"type":"number","literal":null,"literals":null,"required":true,"pattern":null},"startLine":{"type":"number","literal":null,"literals":null,"required":true,"pattern":null},"endLine":{"type":"number","literal":null,"literals":null,"required":true,"pattern":null},"totalLines":{"type":"number","literal":null,"literals":null,"required":true,"pattern":null}}},{"name":"number","fields":{"kind":{"type":null,"literal":"number","literals":null,"required":true,"pattern":null},"value":{"type":"number","literal":null,"literals":null,"required":true,"pattern":null},"range":{"type":"observableRange","literal":null,"literals":null,"required":false,"pattern":null}}},{"name":"redacted","fields":{"kind":{"type":null,"literal":"redacted","literals":null,"required":true,"pattern":null},"reason":{"type":null,"literal":"protected","literals":null,"required":true,"pattern":null}}},{"name":"unavailable","fields":{"kind":{"type":null,"literal":"unavailable","literals":null,"required":true,"pattern":null},"reason":{"type":null,"literal":null,"literals":["not-exposed","unknown"],"required":true,"pattern":null}}}]},"observableRange":{"fields":{"minimum":{"type":"number","literal":null,"literals":null,"required":true,"pattern":null},"maximum":{"type":"number","literal":null,"literals":null,"required":true,"pattern":null},"step":{"type":"number","literal":null,"literals":null,"required":false,"pattern":null}},"variants":null},"action":{"fields":{"name":{"type":"string","literal":null,"literals":null,"required":true,"pattern":null},"description":{"type":"string","literal":null,"literals":null,"required":false,"pattern":null},"localizedName":{"type":"string","literal":null,"literals":null,"required":false,"pattern":null},"availability":{"type":"availabilityState","literal":null,"literals":null,"required":true,"pattern":null},"disabledBy":{"type":"string","literal":null,"literals":null,"required":false,"pattern":null}},"variants":null},"range":{"fields":{"minimum":{"type":"number","literal":null,"literals":null,"required":true,"pattern":null},"maximum":{"type":"number","literal":null,"literals":null,"required":true,"pattern":null},"current":{"type":"number","literal":null,"literals":null,"required":true,"pattern":null},"step":{"type":"number","literal":null,"literals":null,"required":false,"pattern":null}},"variants":null},"operation":{"fields":{"operation":{"type":"operationName","literal":null,"literals":null,"required":true,"pattern":null},"availability":{"type":"availabilityState","literal":null,"literals":null,"required":true,"pattern":null},"disabledBy":{"type":"string","literal":null,"literals":null,"required":false,"pattern":null},"range":{"type":"range","literal":null,"literals":null,"required":false,"pattern":null}},"variants":null},"installedApplication":{"fields":{"name":{"type":"string","literal":null,"literals":null,"required":true,"pattern":null},"capabilities":{"type":"capability[]","literal":null,"literals":null,"required":true,"pattern":null},"launchable":{"type":"boolean","literal":null,"literals":null,"required":true,"pattern":null},"running":{"type":"runningState","literal":null,"literals":null,"required":true,"pattern":null},"runningUnknownBy":{"type":"string","literal":null,"literals":null,"required":false,"pattern":null},"diagnostic":{"type":"diagnostic","literal":null,"literals":null,"required":false,"pattern":null}},"variants":null},"capability":{"fields":{"capability":{"type":"capabilityName","literal":null,"literals":null,"required":true,"pattern":null},"availability":{"type":"availabilityState","literal":null,"literals":null,"required":true,"pattern":null},"disabledBy":{"type":"string","literal":null,"literals":null,"required":false,"pattern":null}},"variants":null},"subscription":{"fields":{"subscriptionId":{"type":"string","literal":null,"literals":null,"required":true,"pattern":null},"id":{"type":"string","literal":null,"literals":null,"required":true,"pattern":"idPattern"},"priority":{"type":"priority","literal":null,"literals":null,"required":true,"pattern":null}},"variants":null},"changeEvent":{"fields":{"subscriptionId":{"type":"string","literal":null,"literals":null,"required":true,"pattern":null},"id":{"type":"string","literal":null,"literals":null,"required":true,"pattern":"idPattern"},"role":{"type":"role","literal":null,"literals":null,"required":true,"pattern":null},"kind":{"type":"changeKind","literal":null,"literals":null,"required":true,"pattern":null},"attribution":{"type":"attribution","literal":null,"literals":null,"required":true,"pattern":null},"causeId":{"type":"string","literal":null,"literals":null,"required":false,"pattern":null},"priority":{"type":"priority","literal":null,"literals":null,"required":true,"pattern":null},"at":{"type":"number","literal":null,"literals":null,"required":true,"pattern":null}},"variants":null},"elementDiscoveryEntry":{"fields":{"role":{"type":"role","literal":null,"literals":null,"required":true,"pattern":null},"name":{"type":"string","literal":null,"literals":null,"required":true,"pattern":null},"count":{"type":"number","literal":null,"literals":null,"required":true,"pattern":null},"actions":{"type":"string[]","literal":null,"literals":null,"required":true,"pattern":null},"operations":{"type":"string[]","literal":null,"literals":null,"required":true,"pattern":null}},"variants":null},"diagnostic":{"fields":{"nativeRole":{"type":"string","literal":null,"literals":null,"required":false,"pattern":null},"nativeId":{"type":"string","literal":null,"literals":null,"required":false,"pattern":null}},"variants":null},"accessibilityLayer":{"fields":{"state":{"type":"accessibilityState","literal":null,"literals":null,"required":true,"pattern":null},"reason":{"type":"string","literal":null,"literals":null,"required":false,"pattern":null}},"variants":null},"desktopPlaces":{"fields":{"home":{"type":"string","literal":null,"literals":null,"required":false,"pattern":null},"downloads":{"type":"string","literal":null,"literals":null,"required":false,"pattern":null}},"variants":null},"capturedImage":{"fields":{"format":{"type":"string","literal":null,"literals":null,"required":true,"pattern":null},"width":{"type":"number","literal":null,"literals":null,"required":true,"pattern":null},"height":{"type":"number","literal":null,"literals":null,"required":true,"pattern":null},"data":{"type":"string","literal":null,"literals":null,"required":true,"pattern":null}},"variants":null}} as const;
const VOCABULARY_VALUES: Record<string, readonly string[]> = {"role":["application","window","dialog","button","checkbox","label","link","list","listitem","grid","row","gridcell","menu","menuitem","text","textbox","image","generic"],"state":["enabled","visible","focused","selected","checked","expanded","offscreen"],"availabilityState":["available","disabled-by-configuration","not-exposed"],"runningState":["answering","not-answering","cannot-tell"],"accessibilityState":["enabled","disabled","cannot-tell"],"operationName":["setValue","setText","setCaret","reveal"],"capabilityName":["observe","launch","edit","activate","submit","rawInput"],"keyChordName":["Enter","Escape","Tab","Backspace","Delete","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End","PageUp","PageDown","F2"],"priority":["low","medium","high"],"changeKind":["appeared","disappeared","changed","watchEnded"],"attribution":["self","external","unattributed"]};

type FieldSpec = {
  type: string | null;
  literal: string | number | null;
  literals: readonly string[] | null;
  required: boolean;
  pattern: string | null;
};
type TypeName = keyof typeof TYPE_SPECS;

function problemsFor(typeName: TypeName, value: unknown): string[] {
  if (typeof value !== "object" || value === null) {
    return [`${String(typeName)}: not an object`];
  }
  const record = value as Record<string, unknown>;
  const typeSpec = TYPE_SPECS[typeName];
  if (typeSpec.variants) {
    const variant = typeSpec.variants.find(({ fields }) =>
      Object.values(fields).some((field) => field.literal !== null && record.kind === field.literal),
    );
    if (!variant) return [`${String(typeName)}.kind: ${JSON.stringify(record.kind)} does not select a variant`];
    const problems = fieldProblems(String(typeName), variant.fields as Record<string, FieldSpec>, record, true);
    if (typeName === "observableContent") problems.push(...observableContentProblems(record));
    return problems;
  }
  return fieldProblems(String(typeName), typeSpec.fields as Record<string, FieldSpec>, record, false);
}

function observableContentProblems(record: Record<string, unknown>): string[] {
  if (record.kind !== "text-window") return [];
  const problems: string[] = [];
  const integerFields = ["offset", "length", "totalLength", "startLine", "endLine", "totalLines"] as const;
  for (const field of integerFields) {
    const value = record[field];
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      problems.push(`observableContent.${field}: expected a safe integer`);
    }
  }
  const offset = record.offset;
  const length = record.length;
  const totalLength = record.totalLength;
  const startLine = record.startLine;
  const endLine = record.endLine;
  const totalLines = record.totalLines;
  if (typeof offset === "number" && offset < 0) problems.push("observableContent.offset: must not be negative");
  if (typeof length === "number" && length < 0) problems.push("observableContent.length: must not be negative");
  if (typeof totalLength === "number" && totalLength < 0) problems.push("observableContent.totalLength: must not be negative");
  if (typeof record.value === "string" && typeof length === "number" && Array.from(record.value).length !== length) {
    problems.push("observableContent.length: must equal the Unicode-scalar length of value");
  }
  if (typeof offset === "number" && typeof length === "number" && typeof totalLength === "number" && offset + length > totalLength) {
    problems.push("observableContent: offset plus length exceeds totalLength");
  }
  if (typeof startLine === "number" && startLine < 1) problems.push("observableContent.startLine: must be at least one");
  if (typeof endLine === "number" && typeof startLine === "number" && endLine < startLine) problems.push("observableContent.endLine: must not precede startLine");
  if (typeof totalLines === "number" && typeof endLine === "number" && totalLines < endLine) problems.push("observableContent.totalLines: must not precede endLine");
  return problems;
}

function fieldProblems(typeName: string, specs: Record<string, FieldSpec>, record: Record<string, unknown>, exact: boolean): string[] {
  const problems: string[] = [];
  if (exact) {
    for (const field of Object.keys(record)) {
      if (!(field in specs)) problems.push(`${typeName}.${field}: field is not valid for this variant`);
    }
  }
  for (const [field, spec] of Object.entries(specs)) {
    const present = field in record && record[field] !== undefined;
    if (!present) {
      if (spec.required) problems.push(`${typeName}.${field}: required field is missing`);
      continue;
    }
    const v = record[field];
    if (spec.literal !== null && v !== spec.literal) {
      problems.push(`${typeName}.${field}: expected ${JSON.stringify(spec.literal)}`);
      continue;
    }
    if (spec.literals !== null && !spec.literals.includes(v as string)) {
      problems.push(`${typeName}.${field}: ${JSON.stringify(v)} is not an allowed value`);
      continue;
    }
    if (spec.type === null) continue;
    const base = spec.type.replace("[]", "");
    const isArray = spec.type.endsWith("[]");
    const values = isArray ? (Array.isArray(v) ? v : null) : [v];
    if (values === null) {
      problems.push(`${typeName}.${field}: expected an array`);
      continue;
    }
    for (const item of values) {
      if (base === "string" && typeof item !== "string") problems.push(`${typeName}.${field}: expected a string`);
      else if (base === "number" && typeof item !== "number") problems.push(`${typeName}.${field}: expected a number`);
      else if (base === "boolean" && typeof item !== "boolean") problems.push(`${typeName}.${field}: expected a boolean`);
      else if (base in VOCABULARY_VALUES && !VOCABULARY_VALUES[base].includes(item as string)) problems.push(`${typeName}.${field}: ${JSON.stringify(item)} is not one of the ${base} values`);
      else if (base in TYPE_SPECS) problems.push(...problemsFor(base as TypeName, item));
    }
    if (spec.pattern === "idPattern" && typeof v === "string" && !ID_PATTERN.test(v)) {
      problems.push(`${typeName}.${field}: ${JSON.stringify(v)} does not match the id pattern`);
    }
  }
  problems.push(...availabilityProblems(typeName, specs, record));
  return problems;
}

/**
 * The rule the field specs cannot express, enforced wherever an availability
 * appears: a thing withheld by configuration names the setting that withheld
 * it, and nothing else names a setting at all. This is what keeps the three
 * availability states from collapsing into each other. "Turned off by a
 * setting" and "never offered by the platform" look alike to a caller and are
 * opposites to anyone deciding what to do next: the first is a door with a
 * key, the second is a wall. A withheld thing with no setting named is an
 * unanswerable refusal, and an unexposed thing that names one invents a remedy
 * that does not exist.
 */
function availabilityProblems(typeName: string, specs: Record<string, FieldSpec>, record: Record<string, unknown>): string[] {
  if (!("availability" in specs)) return [];
  const problems: string[] = [];
  const withheld = record.availability === "disabled-by-configuration";
  const names = typeof record.disabledBy === "string" && record.disabledBy.length > 0;
  if (withheld && !names) problems.push(`${typeName}.disabledBy: an availability withheld by configuration must name the setting that withholds it`);
  if (!withheld && record.disabledBy !== undefined) problems.push(`${typeName}.disabledBy: present on an availability of ${JSON.stringify(record.availability)} - only a configuration-withheld one names a setting`);
  return problems;
}

/** Validate a semanticElement; returns an empty array when it conforms. */
export function validateSemanticElement(value: unknown): string[] {
  return problemsFor("semanticElement", value);
}

/** Validate an elementDiscoveryEntry; returns an empty array when it conforms. */
export function validateElementDiscoveryEntry(value: unknown): string[] {
  return problemsFor("elementDiscoveryEntry", value);
}

/** Validate one installedApplication as the listing reports it; returns an empty array when it conforms. */
export function validateInstalledApplication(value: unknown): string[] {
  return problemsFor("installedApplication", value);
}

/**
 * Validate a changeEvent; returns an empty array when it conforms. Beyond the
 * field specs it enforces the one rule the specs cannot express: a cause id is
 * present if and only if the change is attributed to this session.
 */
export function validateChangeEvent(value: unknown): string[] {
  const problems = problemsFor("changeEvent", value);
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const claimsSelf = record.attribution === "self";
  const hasCause = record.causeId !== undefined;
  if (claimsSelf && !hasCause) problems.push("changeEvent.causeId: a change attributed to self must name the call that caused it");
  if (!claimsSelf && hasCause) problems.push(`changeEvent.causeId: present on a change attributed to ${JSON.stringify(record.attribution)} - only self carries a cause`);
  return problems;
}


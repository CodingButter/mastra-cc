// GENERATED from protocol/schema.json - do not edit (ADR-0009).
// Mastra CC protocol v1.3.0

export const PROTOCOL_VERSION = "1.3.0";
export const SCHEMA_DIGEST = "6259a2d17036a46458e0e55970f05f2cb72fe4569c5e3eda65a0c293dee02d65";
export const ID_PATTERN = new RegExp("^(el|win|app)-[0-9a-f]{12}$");
export const ROLES = ["application","window","dialog","button","checkbox","label","link","list","listitem","menu","menuitem","text","textbox","image","generic"] as const;
export type Role = (typeof ROLES)[number];
export const STATES = ["enabled","visible","focused","selected","checked","expanded","offscreen"] as const;
export type State = (typeof STATES)[number];
export const ACTIONS = ["press","focus","select","expand"] as const;
export type ActionName = (typeof ACTIONS)[number];
export const PRIORITIES = ["low","medium","high"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const CHANGE_KINDS = ["appeared","disappeared","changed","watchEnded"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];
export const ATTRIBUTIONS = ["self","external","unattributed"] as const;
export type Attribution = (typeof ATTRIBUTIONS)[number];
export const METHOD_NAMES = ["queryElements","attestElement","subscribeElement","unsubscribeElement","openApplication","editElement","activateElement","submitElement"] as const;
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
  /** What a later call could be asked to do. M1 implements none of them. */
  actions: ActionName[];
  /** Debug-only carrier and the only exemption from the neutral-vocabulary rule: native identifiers may appear here for a human reading a log, and are never load-bearing. */
  diagnostic?: Diagnostic;
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
  /** Who caused it. Never guessed: when it cannot be decided the answer is the undecidable one, not the flattering one. */
  attribution: Attribution;
  /** Names the call this change was caused by. Present if and only if the attribution is self; its absence anywhere else is the contract, not an omission. */
  causeId?: string;
  /** The urgency the subscriber declared when it asked for this watch, carried back unread. */
  priority: Priority;
  /** When the daemon observed the change, in milliseconds since the epoch. */
  at: number;
}

/** Native details preserved for a human debugging. Exempt from the neutral-vocabulary rule; never load-bearing for agent logic. */
export interface Diagnostic {
  /** The backend's own role word, verbatim. */
  nativeRole?: string;
  /** The backend's own identifier for the element, verbatim. */
  nativeId?: string;
}

/** Find elements matching a semantic query. Observation only. */
export interface QueryElementsParams {
  /** Restrict the answer to one role. */
  role?: Role;
  /** Restrict the answer to elements whose normalised name matches. */
  name?: string;
  /** Upper bound on the number of returned elements. */
  limit?: number;
}

export interface QueryElementsResult {
  /** Every element that matched, in reading order. */
  elements: SemanticElement[];
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

/** Replace a text field's content. Edit-class: changes what an element holds without committing anything beyond it. Defined on the wire before it is possible; until an edit-authority surface exists, every call is refused by name. */
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

/** Perform one advertised action on an element. Activate-class: causes the element to do the thing it exists to do. Defined on the wire before it is possible; until an activate-authority surface exists, every call is refused by name. */
export interface ActivateElementParams {
  /** The element the action would be performed on. */
  id: string;
  /** One of the element's advertised actions. */
  action: ActionName;
}

export interface ActivateElementResult {
  /** Present when the action was performed; the element as it reads afterwards. */
  element?: SemanticElement;
  /** Present otherwise; names the check that ran and what would change the answer. */
  refusal?: string;
}

/** Commit something beyond the machine's ability to take back. Submit-class: the attestation is the machine's own restatement of what is being committed, and it is required in every call - the contract makes waiving it inexpressible. Defined on the wire before it is possible; until a submit-authority surface exists, every call is refused by name. */
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

const FIELD_SPECS = {"semanticElement":{"id":{"type":"string","required":true,"pattern":"idPattern"},"role":{"type":"role","required":true,"pattern":null},"name":{"type":"string","required":true,"pattern":null},"states":{"type":"state[]","required":true,"pattern":null},"actions":{"type":"action[]","required":true,"pattern":null},"diagnostic":{"type":"diagnostic","required":false,"pattern":null}},"subscription":{"subscriptionId":{"type":"string","required":true,"pattern":null},"id":{"type":"string","required":true,"pattern":"idPattern"},"priority":{"type":"priority","required":true,"pattern":null}},"changeEvent":{"subscriptionId":{"type":"string","required":true,"pattern":null},"id":{"type":"string","required":true,"pattern":"idPattern"},"role":{"type":"role","required":true,"pattern":null},"kind":{"type":"changeKind","required":true,"pattern":null},"attribution":{"type":"attribution","required":true,"pattern":null},"causeId":{"type":"string","required":false,"pattern":null},"priority":{"type":"priority","required":true,"pattern":null},"at":{"type":"number","required":true,"pattern":null}},"diagnostic":{"nativeRole":{"type":"string","required":false,"pattern":null},"nativeId":{"type":"string","required":false,"pattern":null}}} as const;
const VOCABULARY_VALUES: Record<string, readonly string[]> = {"role":["application","window","dialog","button","checkbox","label","link","list","listitem","menu","menuitem","text","textbox","image","generic"],"state":["enabled","visible","focused","selected","checked","expanded","offscreen"],"action":["press","focus","select","expand"],"priority":["low","medium","high"],"changeKind":["appeared","disappeared","changed","watchEnded"],"attribution":["self","external","unattributed"]};

type FieldSpec = { type: string; required: boolean; pattern: string | null };

function problemsFor(typeName: keyof typeof FIELD_SPECS, value: unknown): string[] {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null) {
    return [`${String(typeName)}: not an object`];
  }
  const record = value as Record<string, unknown>;
  const specs = FIELD_SPECS[typeName] as Record<string, FieldSpec>;
  for (const [field, spec] of Object.entries(specs)) {
    const present = field in record && record[field] !== undefined;
    if (!present) {
      if (spec.required) problems.push(`${String(typeName)}.${field}: required field is missing`);
      continue;
    }
    const v = record[field];
    const base = spec.type.replace("[]", "");
    const isArray = spec.type.endsWith("[]");
    const values = isArray ? (Array.isArray(v) ? v : null) : [v];
    if (values === null) {
      problems.push(`${String(typeName)}.${field}: expected an array`);
      continue;
    }
    for (const item of values) {
      if (base === "string" && typeof item !== "string") problems.push(`${String(typeName)}.${field}: expected a string`);
      else if (base === "number" && typeof item !== "number") problems.push(`${String(typeName)}.${field}: expected a number`);
      else if (base === "boolean" && typeof item !== "boolean") problems.push(`${String(typeName)}.${field}: expected a boolean`);
      else if (base in VOCABULARY_VALUES && !VOCABULARY_VALUES[base].includes(item as string)) problems.push(`${String(typeName)}.${field}: ${JSON.stringify(item)} is not one of the ${base} values`);
      else if (base in FIELD_SPECS) problems.push(...problemsFor(base as keyof typeof FIELD_SPECS, item));
    }
    // A pattern named in the schema is enforced wherever it is named, not only
    // on the one type that happened to need it first.
    if (spec.pattern === "idPattern" && typeof v === "string" && !ID_PATTERN.test(v)) {
      problems.push(`${String(typeName)}.${field}: ${JSON.stringify(v)} does not match the id pattern`);
    }
  }
  return problems;
}

/** Validate a semanticElement; returns an empty array when it conforms. */
export function validateSemanticElement(value: unknown): string[] {
  return problemsFor("semanticElement", value);
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


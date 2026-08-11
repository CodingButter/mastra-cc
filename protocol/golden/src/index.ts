// GENERATED from protocol/schema.json - do not edit (ADR-0009).
// Mastra CC protocol v1.2.0

export const PROTOCOL_VERSION = "1.2.0";
export const SCHEMA_DIGEST = "9173694012d266d3c7050bfaaed3ef85b591de30771c89be9d9e529ee0b5b693";
export const ID_PATTERN = new RegExp("^(el|win|app)-[0-9a-f]{12}$");
export const ROLES = ["application","window","dialog","button","checkbox","label","link","list","listitem","menu","menuitem","text","textbox","image","generic"] as const;
export type Role = (typeof ROLES)[number];
export const STATES = ["enabled","visible","focused","selected","checked","expanded","offscreen"] as const;
export type State = (typeof STATES)[number];
export const ACTIONS = ["press","focus","select","expand"] as const;
export type ActionName = (typeof ACTIONS)[number];
export const METHOD_NAMES = ["queryElements","attestElement","openApplication","editElement","activateElement","submitElement"] as const;
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

const FIELD_SPECS = {"semanticElement":{"id":{"type":"string","required":true},"role":{"type":"role","required":true},"name":{"type":"string","required":true},"states":{"type":"state[]","required":true},"actions":{"type":"action[]","required":true},"diagnostic":{"type":"diagnostic","required":false}},"diagnostic":{"nativeRole":{"type":"string","required":false},"nativeId":{"type":"string","required":false}}} as const;

type FieldSpec = { type: string; required: boolean };

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
      else if (base === "role" && !(ROLES as readonly string[]).includes(item as string)) problems.push(`${String(typeName)}.${field}: ${JSON.stringify(item)} is not a role`);
      else if (base === "state" && !(STATES as readonly string[]).includes(item as string)) problems.push(`${String(typeName)}.${field}: ${JSON.stringify(item)} is not a state`);
      else if (base === "action" && !(ACTIONS as readonly string[]).includes(item as string)) problems.push(`${String(typeName)}.${field}: ${JSON.stringify(item)} is not an action`);
      else if (base in FIELD_SPECS) problems.push(...problemsFor(base as keyof typeof FIELD_SPECS, item));
    }
  }
  if (typeName === "semanticElement" && typeof record.id === "string" && !ID_PATTERN.test(record.id)) {
    problems.push(`semanticElement.id: ${JSON.stringify(record.id)} does not match the id pattern`);
  }
  return problems;
}

/** Validate a semanticElement; returns an empty array when it conforms. */
export function validateSemanticElement(value: unknown): string[] {
  return problemsFor("semanticElement", value);
}


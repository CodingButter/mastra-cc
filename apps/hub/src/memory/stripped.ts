// WHAT LONG-TERM MEMORY IS ALLOWED TO KEEP.
//
// ADR-0026 clause 3: one complete stored truth, a different lens per audience.
// The owner sees everything. Long-term agent memory receives a STRIPPED VIEW.
// Exports are stripped hardest.
//
// The subconscious is long-term agent memory. It reads what the agent did, forms
// observations, and keeps them for months. So the thing it is handed carries
// what was done - element identity, the scope it was done under, what refused -
// and never what was on the screen while it happened. An element's accessible
// name is frequently the user's own text: the subject line of a mail, the
// contents of a field, the title of a document. A memory that keeps those keeps
// the user's correspondence.
//
// This is the read path, and it is one function, for ADR-0003's reason: the
// stripping happens here or it does not happen. A second path that builds an
// observation without passing through this file is the failure this module
// exists to make impossible, and it is what the mutation table deletes.

/**
 * What the hub knows about something the agent did. This is the FULL truth -
 * it holds element content, because the agent needs it in the moment to act.
 */
export interface ObservedElement {
  readonly id: string;
  readonly role?: string;
  /** the accessible name: the user's own text, more often than not */
  readonly name?: string;
  /** the element's value: a field's contents */
  readonly value?: string;
}

export interface HubActivity {
  /**
   * The elements the effect or read ANSWERED - the same word, and the same
   * meaning, as the audit record one rung down: an effect answers one, a query
   * answers the set that matched, and what it walked past is nobody's business.
   */
  readonly element: readonly ObservedElement[];
  /** the application it was in */
  readonly application?: string;
  /** the capability the daemon permitted it under */
  readonly scope: string;
  /** what the daemon answered: performed, read, or a refusal class */
  readonly outcome: string;
}

/**
 * THE FOUR FIELDS. The set is frozen by a set assertion in the tests beside
 * this file, for the reason review gave the audit entry in Segment 1: a
 * key-set assertion that merely checks for the absence of a `name` key passes
 * forever while a `text` key creeps in beside it. A new key here is a
 * deliberate edit and a changed assertion.
 */
export interface StrippedObservation {
  /** identity, never content - the same narrowing the audit record makes one rung down */
  readonly element: readonly ObservedIdentity[];
  readonly application: string | null;
  readonly scope: string;
  readonly outcome: string;
}

export interface ObservedIdentity {
  readonly id: string;
  readonly role: string | null;
}

export const STRIPPED_KEYS = ["element", "application", "scope", "outcome"] as const;

/**
 * THE NARROWING, and it is one expression, for the reason the audit record's
 * `identityOf` is one expression: an element reaches long-term memory through
 * this function or it does not reach it at all. Take this call away and the
 * whole element goes into the observation - accessible name, field value and
 * all - which is what the mutation table takes away, and what the leak
 * detector catches when it is gone.
 */
function identityOf(element: ObservedElement): ObservedIdentity {
  return { id: element.id, role: element.role ?? null };
}

/**
 * THE STRIPPING, and it is one expression on purpose. Everything that reaches
 * long-term memory is built here, out of named fields, rather than by spreading
 * the activity and deleting what should not travel: a spread-and-delete keeps
 * whatever field was added to the source since anyone last looked at the delete
 * list, which is how content arrives in a record months after the code that
 * strips it was reviewed.
 */
export function strippedView(activity: HubActivity): StrippedObservation {
  return {
    element: activity.element.map(identityOf),
    application: activity.application ?? null,
    scope: activity.scope,
    outcome: activity.outcome,
  };
}

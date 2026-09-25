import { appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { REFUSAL_CODES, type Refusal, type RefusalOwner } from "@mastra-cc/protocol-types";

// THE RECEIPT (ADR-0026). This module owns the entry shape, the serialisation
// and the sink - and nothing else. It does not know what an effect is, what a
// read is, or which refusals the routes state: server.ts tells it, at the point
// of effect. Everything here is a rule about WHAT MAY BE WRITTEN DOWN, which is
// the half of the audit log ADR-0042 constrains.

// An element in the record is an IDENTITY. An element's accessible name is
// frequently the user's own text - a message subject, the sentence they are
// half way through typing - and ADR-0026 draws the line at identity: the record
// says which element was touched, never what it said. The role rides along
// because it is the daemon's own vocabulary rather than the application's, and
// it is absent where the route never answered one.
export interface AuditElement {
  id: string;
  role?: string;
}

/**
 * What a call site hands over: the element as the route holds it, which is to
 * say with everything the application said about itself still on it. Only `id`
 * is promised, because a refused effect has an id and nothing else.
 */
export interface AuditSubject {
  id: string;
  role?: string;
  name?: string;
  states?: unknown;
  actions?: unknown;
  operations?: unknown;
  diagnostic?: unknown;
}

/**
 * THE NARROWING, and it is a single expression on purpose: an element reaches
 * the record through this function or it does not reach the record at all.
 * Deleting it is what the mutation table deletes, and what the leak detector
 * catches when it is gone.
 */
function identityOf(subject: AuditSubject): AuditElement {
  return subject.role === undefined ? { id: subject.id } : { id: subject.id, role: subject.role };
}

// The attribution machinery's answer, carried through unchanged. Declared
// structurally rather than imported from server.ts so this module depends on
// nothing: the record is the last thing that should acquire opinions about the
// daemon's internals.
export interface AuditCause {
  attribution: string;
  causeId?: string;
}

// THE SEVEN FIELDS. The set is frozen by a set assertion in the Phase 1 tests,
// deliberately: a new key is a new ADR and a changed assertion, never a quiet
// append. An assertion that merely checked for the ABSENCE of a name key would
// pass forever while a `text` key crept in beside it.
export interface AuditEntry {
  /** when the daemon wrote it down, ISO 8601 */
  at: string;
  /** the application the call was about, or null where the route could not name one */
  application: string | null;
  /** every element the call ANSWERED - one for an effect, the answered set for a read */
  element: AuditElement[];
  /** the capability the gate permitted the call under: the value the gate was handed, never recomputed */
  scope: string;
  /** the existing attribution machinery's answer, never a second implementation of it */
  cause: AuditCause;
  /** an IDENTIFIER for the caller's attestation, never the attestation itself */
  attestation: string | null;
  /** performed, read, failed, or refused:CLASS - never a refusal's own sentence */
  outcome: string;
}

// THE CLOSED REFUSAL VOCABULARY, and the reason `outcome` is an enumeration
// rather than prose.
//
// The set is TOTAL over the refusals of REQUESTS, not merely over the ones a
// receipt happens to carry today: every place that answers a request with a
// refusal sentence names one of these, and a refusal naming anything else is a
// build error (the closed-set test).
//
// It is deliberately NOT total over the connection. Four refusals sit below the
// request layer and carry no class: a line that is not JSON (server.ts), a
// first message that is not a hello, a hello whose digest disagrees, and a
// message whose shape is not a request at all. They are the protocol refusing
// to read a line, decided before there is a request to classify - there is no
// method, no element, and nothing was accessed. Classifying them would put four
// names in the vocabulary that no entry can ever carry, which is a different
// kind of dishonesty from the one this set exists to prevent.
//
// Three members of the set do record no access - UnknownMethod,
// EnforcementUnrepresentable and NoMatch - label refusals that record no access
// at all, because they are decided before any route runs, or on the one-shot
// resolve path that serves no request. They belong in the vocabulary anyway:
// the vocabulary is a statement about what this daemon can refuse, and an
// unnamed refusal is how a sentence ends up standing in for a category.
//
// The first nine are the SEAM's own classes, recorded under their constructor
// name so the record and the throw site cannot drift; they are exactly the
// nine performEffect translates (backend.ts, and the same list the conformance
// suite pins). Everything below them is a refusal the SERVER states as a
// constant of its own - a seam error the server translates is recorded under
// the server's name for it, because the server's constant is what the caller
// was actually handed.
// The vocabulary is the schema's (refusalCodes, ADR-0113): adding a class is
// a schema change, and REFUSAL_OWNER below must then name its owner.
export const REFUSAL_CLASSES = REFUSAL_CODES;

export type RefusalClass = (typeof REFUSAL_CLASSES)[number];

/**
 * Inside the daemon a route writes its refusal as the sentence and states its
 * class beside it; withoutInternals builds the wire object from the two. The
 * wire type's structured refusal is therefore the sentence until then.
 */
export type Unwired<T> = T extends { refusal?: Refusal } ? Omit<T, "refusal"> & { refusal?: string } : T;

/**
 * A result carrying the CLASS of its own refusal, and - where the shape of the
 * result cannot say it - which element the call was about. Both are stated
 * where the answer is written and travel with it; a class is never recovered by
 * reading the sentence back, because a sentence is prose and prose is not a
 * category.
 *
 * These fields are INTERNAL. handleRequest strips them in one place before the
 * result reaches the wire, so nothing the schema does not define is ever
 * serialised to a client.
 */
export type Classified<T> = Unwired<T> & {
  refusalClass?: RefusalClass;
  auditElement?: AuditSubject[];
  /**
   * The application this call turned out to be about, stated by the route that
   * found out. A launch learns its tree name only AFTER the authority gate lets
   * it look at the catalog, so the receipt reads the name back from the answer
   * rather than resolving it up front: resolving it up front is a catalog read
   * before the permit check, which is the capability probe ADR-0019 forbids -
   * and which the launch-authority spies catch.
   */
  auditApplication?: string;
};

export const INTERNAL_KEYS = ["refusalClass", "auditElement", "auditApplication"] as const;

/** the wire gets what the schema defines and nothing else */
export function withoutInternals<T>(result: T): T {
  if (result === null || typeof result !== "object") return result;
  const stripped = { ...(result as Record<string, unknown>) };
  if (typeof stripped.refusal === "string") {
    const code = stripped.refusalClass;
    stripped.refusal = refusalOf(typeof code === "string" && isRefusalClass(code) ? code : "Unclassified", stripped.refusal);
  }
  for (const key of INTERNAL_KEYS) delete stripped[key];
  return stripped as T;
}

/**
 * WHOSE REFUSAL IT IS (ADR-0113). Every code has exactly one owner, and the
 * Record type makes a new code without one a compile error:
 * - agent: the caller asked for something malformed, unknown, stale, or beyond
 *   what the operator allowed; asking differently can succeed.
 * - world: the desktop or the application said no, went away, froze, or
 *   changed under the call; the daemon reported it faithfully.
 * - daemon: this daemon failed its own contract. A benchmark counts these.
 */
export const REFUSAL_OWNER: Record<RefusalClass, RefusalOwner> = {
  AttestationFailedError: "world",
  EffectUnsupportedError: "world",
  KeyboardHeldElsewhereError: "world",
  MagnitudeOutOfRangeError: "agent",
  OperationNotExposedError: "agent",
  PointerBlockedError: "world",
  RecordingNotPerformableError: "world",
  TextOffsetOutOfRangeError: "agent",
  UnperformableElementError: "world",
  UnpublishedActionError: "agent",
  WriteNotObservedError: "world",
  AccessibilityNotAcquirable: "world",
  AccessibilityNotAcquired: "world",
  AccessibilityLostMidSession: "world",
  AlreadyRunning: "world",
  BackendUnreadable: "daemon",
  CouldNotStart: "world",
  DeadlineExceeded: "world",
  BlockedByDialog: "world",
  DisabledByConfiguration: "agent",
  EffectClassGate: "agent",
  ElementGone: "world",
  EnforcementUnrepresentable: "daemon",
  InventoryUnsupported: "world",
  LaunchUnavailable: "world",
  MalformedParameter: "agent",
  NoConnection: "agent",
  NoMatch: "agent",
  RestartNotConfirmed: "world",
  RestartNotOurs: "agent",
  RestartRefusedByApplication: "world",
  NoRecipe: "world",
  NotReadableInTime: "world",
  OneBrowserIdentity: "agent",
  UnknownElement: "agent",
  UnknownMethod: "agent",
  UnknownSubscription: "agent",
  WatchDeaf: "daemon",
  WatchUnknownElement: "agent",
  WatchUnsupported: "world",
  ApplicationGone: "world",
  DriverBusy: "world",
  DriverClosed: "agent",
  WindowScopeUnmatched: "agent",
  WindowScopeAmbiguous: "agent",
  ApplicationScopeUnmatched: "agent",
  ApplicationScopeAmbiguous: "agent",
  Unclassified: "daemon",
};

/**
 * The next move, where one is the same every time a code is refused. Codes
 * whose next move depends on the case leave it to the message.
 */
export const REFUSAL_NEXT: Partial<Record<RefusalClass, string>> = {
  DeadlineExceeded: "the application did not answer in time; read the element again before retrying, since an effect may have happened",
  BlockedByDialog: "a page dialog is open; it must be closed by a human or the page before this target answers again",
  UnknownElement: "query again and use an id from the new answer",
  EffectClassGate: "this session was not started with that class; ask the operator, do not route around it",
  RestartNotOurs: "only an application this daemon started can be restarted by it",
  Unclassified: "report this as a daemon fault; do not retry blindly",
};

export function refusalOf(code: RefusalClass, message: string): Refusal {
  const next = REFUSAL_NEXT[code];
  return next === undefined ? { class: REFUSAL_OWNER[code], code, message } : { class: REFUSAL_OWNER[code], code, message, next };
}

const CLASS_SET: ReadonlySet<string> = new Set(REFUSAL_CLASSES);

export function isRefusalClass(name: string): name is RefusalClass {
  return CLASS_SET.has(name);
}

/** the effect happened */
export const PERFORMED = "performed";
/** the call answered elements and changed nothing */
export const READ = "read";
/**
 * The route threw something that is not a refusal. The caller gets the opaque
 * backstop constant; the record says the access was attempted and did not
 * finish, which is the fact ADR-0022 asks for and a refusal class would
 * misreport.
 */
export const FAILED = "failed";

// The only way to build a refusal outcome. It takes a CLASS, never a sentence,
// so there is no call shape in which a refusal's own words could reach the
// disk: the sentence goes to the caller, as it always has.
//
// An unclassified refusal is recorded as such rather than quoted or dropped.
// The closed-set test makes it unreachable in a passing build; if it ever fires
// in the field, the record says the daemon refused AND says it could not name
// the refusal, which are two different facts and both true.
export function refused(refusalClass: RefusalClass | undefined): string {
  return refusalClass === undefined ? "refused:unclassified" : `refused:${refusalClass}`;
}

// An attestation is the caller's restatement of what a commit would do, and it
// quotes the element by name. It is therefore content, and content does not go
// in the record - but WHICH attestation was carried is an identity, and a
// digest is exactly that: two entries carrying the same attestation match, and
// no entry carries the words.
export function attestationIdentifier(attestation: string | undefined): string | null {
  if (attestation === undefined || attestation === "") return null;
  return `sha256:${createHash("sha256").update(attestation).digest("hex").slice(0, 16)}`;
}

/**
 * THE LEAK DETECTOR, and it lives here rather than in the test that first needs
 * it because ADR-0003 allows one implementation of a rule: the same question is
 * asked of the daemon's own audit file in this package's tests, of a spawned
 * daemon's file across a process boundary in the hub's, and of whatever the
 * agent's memory is later given to read. Three copies would drift, and the copy
 * that drifted would be the one that stopped finding anything.
 *
 * The vocabulary is a PARAMETER, taken from the fixture the run actually read,
 * so a re-captured tape brings its own words with it and this check never
 * decays into a search for terms nobody says any more.
 *
 * What belongs in the vocabulary: the accessible NAMES and VALUES of the tree -
 * the user's own text, which is what ADR-0026 says the record must not hold.
 * What deliberately does not: the application's name and the daemon's role
 * vocabulary, both of which the entry shape records ON PURPOSE. A detector
 * handed those would report the record working as designed as a leak, and a
 * detector that cried wolf would be switched off within a week.
 */
export function leakedTerms(record: string, vocabulary: readonly string[]): string[] {
  const found = new Set<string>();
  for (const term of vocabulary) {
    if (term.trim() === "") continue;
    if (record.includes(term)) found.add(term);
  }
  return [...found];
}

export interface AuditSink {
  readonly path: string;
  record(entry: AuditEntry): void;
}

/**
 * What a call site knows. The daemon says what happened; this module decides
 * what that looks like on disk - the timestamp and the attestation's identifier
 * are computed here, because both are entry-shape rules rather than facts about
 * the effect.
 */
export interface AuditRecord {
  application: string | undefined;
  /**
   * The elements the call answered, AS THE ROUTE HOLDS THEM. A route hands over
   * the element it actually answered - name, states, actions and all - and the
   * narrowing to identity happens here, once, on the way to the disk.
   *
   * The alternative was asking every call site to hand over an id and a role it
   * had picked out itself, and it was rejected: that makes three call sites
   * each responsible for remembering the rule, and a fourth added later
   * responsible for noticing there was one. The rule about what may be written
   * down belongs to the module that writes.
   */
  element: AuditSubject[];
  scope: string;
  cause: AuditCause;
  attestation?: string;
  outcome: string;
}

// One JSON object per line, append-only, keys in a fixed order. The order is
// not decoration: a receipt is read by people and by grep, and a stable prefix
// is what makes both possible.
function serialise(entry: AuditEntry): string {
  return `${JSON.stringify({
    at: entry.at,
    application: entry.application,
    element: entry.element,
    scope: entry.scope,
    cause: entry.cause,
    attestation: entry.attestation,
    outcome: entry.outcome,
  })}\n`;
}

// A sink that cannot be written to REPORTS, and the effect still completes.
// ADR-0022's reasoning applied here: refusing an effect because the receipt
// could not be filed causes harm to defend bookkeeping. The report names the
// entry that was lost - identity only, on the same terms as the entry itself -
// so an operator sees WHICH access went unrecorded rather than only that one
// did.
function reportUnwritten(path: string, entry: AuditEntry, error: unknown): void {
  const identity = entry.element.map((element) => element.id).join(", ");
  console.error(
    `daemon: audit entry NOT WRITTEN to ${path} (${(error as Error).message}) - ` +
      `at ${entry.at}, scope ${entry.scope}, outcome ${entry.outcome}, element ${identity === "" ? "(none)" : identity}`,
  );
}

export function openAuditLog(path: string): AuditSink {
  // A missing parent directory is worth creating; a failure here is not worth
  // refusing the boot over, because the first write reports it in the one place
  // that reports.
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    // reported at the first write
  }
  return {
    path,
    record(entry: AuditEntry): void {
      try {
        appendFileSync(path, serialise(entry), "utf8");
      } catch (error) {
        reportUnwritten(path, entry, error);
      }
    },
  };
}

// A daemon nobody asked to keep a receipt keeps none. There is no default path:
// an audit log is a concentration of exactly the information ADR-0026 says to
// be careful with, and creating one because the operator forgot to say
// otherwise would be the wrong default in the only direction that matters.
let sink: AuditSink | undefined;

export function useAuditLog(next: AuditSink | undefined): void {
  sink = next;
}

export function recordAudit(record: AuditRecord): void {
  if (sink === undefined) return;
  sink.record({
    at: new Date().toISOString(),
    application: record.application ?? null,
    element: record.element.map(identityOf),
    scope: record.scope,
    cause: record.cause,
    attestation: attestationIdentifier(record.attestation),
    outcome: record.outcome,
  });
}

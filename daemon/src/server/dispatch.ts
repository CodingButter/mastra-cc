import { KEY_CHORD_NAMES, type KeyChordName, PROTOCOL_VERSION, type CapabilityName, type SemanticElement } from "@mastra-cc/protocol-types";
import { type Backend, ElementGoneError, PeerGoneError, CallDeadlineError, AttestationFailedError, IncompleteObservationError, EffectUnsupportedError, MagnitudeOutOfRangeError, OperationNotExposedError, TextOffsetOutOfRangeError, UnperformableElementError, UnpublishedActionError, WriteNotObservedError, KeyboardHeldElsewhereError, PointerBlockedError } from "../backend.js";
import { FAILED, PERFORMED, READ, recordAudit, refused, withoutInternals, refusalOf, type AuditCause, type AuditSubject, type Classified, type RefusalClass, auditWritable, unwrittenEffectEntries } from "../audit.js";
import { DRIVER_CLOSED, type DriverAuthority, type DriverConnection } from "../driver.js";
import { CancelledAtBoundaryError, underCancellation } from "../cancellation.js";
import { DialogBlockingError } from "../backends/cdp/channel.js";
import { ACTIVATE_SCOPE_REFUSAL, APPLICATION_GONE_REFUSAL, BACKEND_UNREADABLE_REFUSAL, EDIT_SCOPE_REFUSAL, ELEMENT_GONE_REFUSAL, LaunchContext, NO_CLEAR_ROUTE_REFUSAL, NO_KEY_ROUTE_REFUSAL, NO_PERMITS, NO_POINTER_ROUTE_REFUSAL, NO_TYPE_ROUTE_REFUSAL, POINTER_BUTTON_NAMES, REVEAL_SCOPE_REFUSAL, SET_CARET_SCOPE_REFUSAL, SET_TEXT_SCOPE_REFUSAL, SET_VALUE_SCOPE_REFUSAL, SUBMIT_SCOPE_REFUSAL, configurationWithholding, holdsEffectAuthority, observedWithConfiguration, outsideElementRefusal, rawInputScopeRefusal, typeTextRefusal, unknownButtonRefusal, unknownCapturedAtRefusal, unknownChordRefusal, unknownClickCountRefusal, withheldRefusal } from "./grants.js";
import { acquireAccessibility, auditedAcquire, describeAccessibility, describeDesktop, discoverElements, focusBeforeEffect, listApplications, openApplication, queryElements, restartApplication, restoreFocusAfterEffect, withFocusNote } from "./launch-focus.js";
import { serialised, targetOf } from "./queues.js";
import { SubscriptionBook, attribute, causeNames, mintCauseId, operation, subscribeElement, unsubscribeElement } from "./subscriptions.js";

// The three element verbs, each refused BEFORE the backend is reached when this
// session does not hold the class. Written as named functions rather than inline
// in the table because the table's entries must each stay on one line - and
// because the ordering inside them is the property the timing test pins: the
// authority question is asked first, and every path that answers it "no" returns
// without an await against the backend.
//
// The backend's own error vocabulary is translated to refusals here, at the one
// place that knows both sides. Each translation keeps the backend's sentence
// intact: the seam already names the check that ran and what would change the
// answer, and rewording it here would put the daemon's voice over the
// application's measurement.
//
// Naming the target is what makes the change self-attributed, and it happens
// here for the same reason openApplication does it after its permit check: the
// name is asked for only once the call is allowed to proceed. The backend
// answers from what it already recorded while walking, so this costs no
// exchange - and an id the backend never answered names nothing, which leaves
// every concurrent change unattributed rather than guessed (ADR-0039).
export async function performEffect(
  effectClass: CapabilityName,
  method: string,
  refusal: string,
  launch: LaunchContext,
  backend: Backend,
  id: string,
  // The closure may answer with a refusal of its own rather than an element -
  // that is how a malformed parameter is refused AFTER both gates have run.
  // Deciding it here, inside the closure, is ADR-0021's ordering applied one
  // rung down: refusing for want of authority says nothing about whether the
  // parameters were any good, and a session that lacks the class must not be
  // handed a critique of the value it sent instead of the sentence about the
  // class it does not hold.
  perform: () => Promise<Classified<{ element?: SemanticElement; refusal?: string }>>,
  // The attestation the caller carried, where the method takes one. The audit
  // module hashes it into an identifier; the words never reach the record.
  attestation?: string,
): Promise<Classified<{ element?: SemanticElement; refusal?: string }>> {
  // THE FIRST OF THE THREE AUDIT CALL SITES (ADR-0026). Every element effect
  // this daemon performs or refuses passes through the decision below, and the
  // receipt is written once, here, after it - never inside the branches, which
  // is how an effect ends up with a path that leaves no receipt.
  //
  // Audit receipts describe the operation this request commanded. Change events
  // deliberately do not inherit that identity without independent causal evidence.
  let application: string | undefined;
  const decide = async (): Promise<Classified<{ element?: SemanticElement; refusal?: string }>> => {
    // Refused for want of authority, and the application is deliberately not
    // asked for: ADR-0019's ordering says an unheld class is answered before
    // anything names a target, and the receipt records what the daemon knew,
    // not what it could have gone and looked up to fill a field in.
    if (!holdsEffectAuthority(launch, effectClass)) return { refusal, refusalClass: "EffectClassGate" };
    // Authority first, configuration second (ADR-0019's order, one rung down):
    // the session-wide answer needs no application, so asking it first means an
    // id this daemon never answered is refused without the configuration ever
    // being consulted about a name nobody can supply. Both run BEFORE the call.
    application = backend.applicationOfElement(id);
    const withheld = configurationWithholding(launch, effectClass, application);
    if (withheld !== undefined) {
      return { refusal: withheldRefusal(method, effectClass, withheld), refusalClass: "DisabledByConfiguration" };
    }
    if (application !== undefined) causeNames(application);
    try {
      return await perform();
    } catch (error) {
      // Every one of these is a refusal the caller can act on, and each carries
      // the sentence the seam wrote. AttestationFailedError is the daemon's own
      // inability to describe a commit (ADR-0008 rule 2) and is deliberately in
      // the same list: it refuses the call, it does not fail it.
      if (error instanceof CallDeadlineError) {
        return { refusal: deadlineRefusal(error, true), refusalClass: "DeadlineExceeded" };
      }
      if (error instanceof DialogBlockingError) {
        return { refusal: dialogRefusal(error, true), refusalClass: "BlockedByDialog" };
      }
      if (
        error instanceof AttestationFailedError ||
        error instanceof UnperformableElementError ||
        error instanceof UnpublishedActionError ||
        error instanceof OperationNotExposedError ||
        error instanceof MagnitudeOutOfRangeError ||
        error instanceof TextOffsetOutOfRangeError ||
        error instanceof WriteNotObservedError ||
        error instanceof KeyboardHeldElsewhereError ||
        error instanceof PointerBlockedError ||
        error instanceof EffectUnsupportedError
      ) {
        return { refusal: error.message, refusalClass: error.constructor.name as RefusalClass };
      }
      throw error;
    }
  };
  let answer: Classified<{ element?: SemanticElement; refusal?: string }>;
  try {
    answer = await decide();
  } catch (error) {
    // The route threw something that is not a refusal. The caller gets the
    // opaque backstop as it always has; the record says an effect was attempted
    // on this element and did not finish, which is a fact about access and is
    // exactly what an access record loses by only writing down the tidy cases.
    recordAudit({ application, element: [{ id }], scope: effectClass, cause: causeOf(application), attestation, outcome: FAILED });
    throw error;
  }
  recordAudit({ application, element: [elementOf(id, answer.element)], scope: effectClass, cause: causeOf(application), attestation, outcome: outcomeOf(answer) });
  return answer;
}

// A peer (browser or application) that did not answer in time. Whether anything changed depends on
// whether the request left this process: an unsent call changed nothing, a
// sent effect has an outcome nobody observed.
export function deadlineRefusal(error: CallDeadlineError, isEffect: boolean): string {
  // Attaching is the one wait that cannot tell a dialog from a busy page: a
  // page already holding a dialog never answers it and never reports it.
  if (error.method === "Page.enable" || error.method === "Page.getFrameTree") {
    return `the page did not answer when attached ("${error.method}") - it may be showing a dialog or be busy; nothing was changed by this call`;
  }
  const base = error.message;
  return isEffect && error.effectSent
    ? `${base} while an effect was in flight - its outcome is UNKNOWN; look before retrying`
    : `${base} - nothing was changed by this call`;
}

// A native dialog freezes the page until a person answers it; the daemon
// never answers it for them.
export function dialogRefusal(error: DialogBlockingError, isEffect: boolean): string {
  const shown = error.dialogMessage.length > 80 ? `${error.dialogMessage.slice(0, 80)}...` : error.dialogMessage;
  const base = `the page is showing a ${error.type} dialog ("${shown}") - nothing can be read or done in it until a person answers it`;
  return isEffect && error.effectSent
    ? `${base}; the effect that was in flight has an UNKNOWN outcome - look before retrying`
    : base;
}

// Identity, and the role only where the daemon actually answered one: a
// refused effect answers no element, and inventing a role for it would put a
// guess in the record beside facts.
export function elementOf(id: string, element: SemanticElement | undefined): AuditSubject {
  return element === undefined ? { id } : element;
}

// The record's own reading of what happened, in the closed vocabulary. A
// refusal is named by its class; the sentence goes to the caller, as it always
// has, and it does not go to disk.
export function outcomeOf(answer: Classified<{ refusal?: string }>): string {
  return answer.refusal === undefined ? PERFORMED : refused(answer.refusalClass);
}

// The cause, from the machinery that already answers this question. An effect
// that named its application is self-attributed under the id minted for it;
// one that named nothing is unattributed, and that honest third answer is
// recorded rather than smoothed into a guess (ADR-0039).
export function causeOf(application: string | undefined): AuditCause {
  return attribute(application ?? "");
}

export function editElement(params: { id?: unknown; value?: unknown }, backend: Backend, launch: LaunchContext) {
  const id = typeof params.id === "string" ? params.id : "";
  const value = typeof params.value === "string" ? params.value : "";
  return performEffect("edit", "editElement", EDIT_SCOPE_REFUSAL, launch, backend, id, () => backend.editElement({ id, value }) as Promise<{ element: SemanticElement }>);
}

export function activateElement(params: { id?: unknown; action?: unknown }, backend: Backend, launch: LaunchContext) {
  const id = typeof params.id === "string" ? params.id : "";
  const action = typeof params.action === "string" ? params.action : "";
  return performEffect("activate", "activateElement", ACTIVATE_SCOPE_REFUSAL, launch, backend, id, () => backend.activateElement({ id, action }) as Promise<{ element: SemanticElement }>);
}

// The attestation is carried and never validated. The daemon cannot check
// whether the caller's restatement is TRUE - two honest restatements of one
// commit differ - so the check that means something is the daemon's own, made
// on the seam against the element as it stands (AttestationFailedError above).
export function submitElement(params: { id?: unknown; attestation?: unknown }, backend: Backend, launch: LaunchContext) {
  const id = typeof params.id === "string" ? params.id : "";
  const attestation = typeof params.attestation === "string" ? params.attestation : "";
  return performEffect("submit", "submitElement", SUBMIT_SCOPE_REFUSAL, launch, backend, id, () => backend.submitElement({ id, attestation }) as Promise<{ element: SemanticElement }>, attestation);
}

// A number that arrives as something other than a number is refused here, by
// name, and this is the one place these four handlers hold a rule of their own.
//
// The string-valued fields need no such rule: an absent or wrong-typed string
// becomes "", and "" is a thing an element can honestly be asked to hold. A
// number has no such empty value. Zero is a magnitude the element may well
// accept, and NaN passes every range check written against it - `NaN < minimum`
// and `NaN > maximum` are both false - so coercing would send the platform a
// value nobody asked for and then report the write as performed. An absent
// optional offset means "the whole content" or "the end of the text", so
// treating a malformed one as absent would invent exactly the default the wire
// is forbidden to invent.
//
// The check runs INSIDE the perform closure, which puts it after both gates.
// That ordering is ADR-0021's, one rung down: a session that does not hold the
// class must hear about the class, not about the value it sent, because
// refusing for want of authority says nothing about whether the parameters were
// any good. It is still before the call - the backend is never touched to
// produce this refusal.
//
// The sentence names the method, the field, and what would change the answer
// (ADR-0008 clause 5), in the shape the change stream's priority refusal
// already uses for a malformed parameter.
export function malformedNumberRefusal(method: string, field: string): string {
  return `refused before the call: "${method}" was given a ${JSON.stringify(field)} that is not a number - the operation is expressed in numbers the element itself published, and there is no value this daemon could substitute that the caller actually asked for`;
}

export function setElementValue(params: { id?: unknown; value?: unknown }, backend: Backend, launch: LaunchContext) {
  const id = typeof params.id === "string" ? params.id : "";
  const value = params.value;
  return performEffect("edit", "setElementValue", SET_VALUE_SCOPE_REFUSAL, launch, backend, id, async () => {
    if (typeof value !== "number" || !Number.isFinite(value)) return { refusal: malformedNumberRefusal("setElementValue", "value"), refusalClass: "MalformedParameter" as const };
    return backend.setElementValue({ id, value });
  });
}

// An absent offset is meaningful on both methods that take one - "replace the
// whole content", "place the caret at the end" - so absent is passed through as
// absent and only a PRESENT malformed one is refused.
export function offsetOf(offset: unknown): number | undefined | "malformed" {
  if (offset === undefined) return undefined;
  if (typeof offset !== "number" || !Number.isFinite(offset)) return "malformed";
  return offset;
}

export function setElementText(params: { id?: unknown; text?: unknown; offset?: unknown }, backend: Backend, launch: LaunchContext) {
  const id = typeof params.id === "string" ? params.id : "";
  const text = typeof params.text === "string" ? params.text : "";
  const offset = offsetOf(params.offset);
  return performEffect("edit", "setElementText", SET_TEXT_SCOPE_REFUSAL, launch, backend, id, async () => {
    if (offset === "malformed") return { refusal: malformedNumberRefusal("setElementText", "offset"), refusalClass: "MalformedParameter" as const };
    return backend.setElementText({ id, text, offset });
  });
}

export function setElementCaret(params: { id?: unknown; offset?: unknown }, backend: Backend, launch: LaunchContext) {
  const id = typeof params.id === "string" ? params.id : "";
  const offset = offsetOf(params.offset);
  return performEffect("edit", "setElementCaret", SET_CARET_SCOPE_REFUSAL, launch, backend, id, async () => {
    if (offset === "malformed") return { refusal: malformedNumberRefusal("setElementCaret", "offset"), refusalClass: "MalformedParameter" as const };
    return backend.setElementCaret({ id, offset });
  });
}

export function revealElement(params: { id?: unknown }, backend: Backend, launch: LaunchContext) {
  const id = typeof params.id === "string" ? params.id : "";
  return performEffect("activate", "revealElement", REVEAL_SCOPE_REFUSAL, launch, backend, id, () => backend.revealElement({ id }));
}

// A KEY, ADDRESSED TO ONE ELEMENT (ADR-0046, ADR-0067).
//
// The ordering inside this function is the design, and each step is here
// because leaving it out would produce a specific lie:
//
//   authority first    - performEffect's gate, same as every other verb, so a
//                        session without the class hears about the class and
//                        the backend is never touched (ADR-0021).
//   reach next         - a build with no route says so without naming a
//                        setting, because no setting would help.
//   vocabulary next    - a chord this contract never defined is refused BY
//                        NAME. The generated validator already refuses it at
//                        the wire, and this is the second lock: the daemon does
//                        not rely on a client having been generated from a
//                        schema it cannot see.
//   focus, borrowed    - read what holds it, aim, and put it back afterwards,
//                        reporting a failure to put it back rather than
//                        claiming a clean keypress (ADR-0044 clause 4).
//   read the desk back - the element as it reads afterwards, which the seam
//                        does, because the emission's own reply says only that
//                        something was sent (ADR-0047).
//
// NOTHING CALLS THIS FUNCTION EXCEPT THE DISPATCH TABLE. That is the whole of
// ADR-0046 clause 3 in one sentence: no failed action, no refused submit and no
// unsupported operation reaches a keystroke, because there is no edge into here
// except a caller explicitly asking for one. It is asserted by a test rather
// than left to a reader's grep.
export function sendKeyChord(params: { id?: unknown; chord?: unknown }, backend: Backend, launch: LaunchContext) {
  const id = typeof params.id === "string" ? params.id : "";
  const chord = typeof params.chord === "string" ? params.chord : "";
  return performEffect(
    "rawInput",
    "sendKeyChord",
    rawInputScopeRefusal(launch.keys !== undefined),
    launch,
    backend,
    id,
    async () => {
      if (launch.keys === undefined) return { refusal: NO_KEY_ROUTE_REFUSAL, refusalClass: "EffectUnsupportedError" as const };
      if (!(KEY_CHORD_NAMES as readonly string[]).includes(chord)) return { refusal: unknownChordRefusal(chord), refusalClass: "MalformedParameter" as const };
      const held = await focusBeforeEffect(backend);
      const answer = await backend.sendKeyChord({ id, chord: chord as KeyChordName });
      const note = await restoreFocusAfterEffect(backend, held, "keypress");
      // The seam always answers with an element (it re-reads); the wire type
      // makes it optional because the refusal shape shares it. Passing an absent
      // element through unchanged rather than asserting one keeps the focus note
      // from being the reason a result gets invented.
      return answer.element === undefined ? answer : { element: withFocusNote(answer.element, note) };
    },
  );
}

// TYPING BLIND (ADR-0070). The same gate order as sendKeyChord above -
// authority, reach, then what was given - and the same borrowed focus and read
// back. The one thing that differs is the vocabulary check: a chord is one of
// fourteen names, a text is any run of printable characters within a bound,
// and the refusal names the character or the length that broke it.
//
// NOTHING CALLS THIS FUNCTION EXCEPT THE DISPATCH TABLE, and in particular
// neither setElementValue nor setElementText does: a field that answered
// `not-exposed` has told the CALLER to decide whether to type, and the daemon
// deciding it for them would be the fallback ADR-0046 clause 3 forbids. The
// test that pins it is type-blind-read-back.test.ts.
// CLEARING BLIND, AND THEN LOOKING (ADR-0076). Same gate order as the other
// two raw-input methods - authority, reach, then the call - and the same
// borrowed focus. What differs is at the far end: the seam refuses when the
// element does not read back empty, so this is the one raw-input verb whose
// success is a comparison rather than a delivery.
//
// NOTHING CALLS THIS FUNCTION EXCEPT THE DISPATCH TABLE, and in particular no
// failed setElementText reaches it: a daemon that emptied a field because a
// semantic write was refused would be doing by keystroke what it had just been
// told it may not do (ADR-0046 clause 3).
export function clearElementText(params: { id?: unknown }, backend: Backend, launch: LaunchContext) {
  const id = typeof params.id === "string" ? params.id : "";
  return performEffect(
    "rawInput",
    "clearElementText",
    rawInputScopeRefusal(launch.keys !== undefined, "clearElementText"),
    launch,
    backend,
    id,
    async () => {
      if (launch.keys === undefined) return { refusal: NO_CLEAR_ROUTE_REFUSAL, refusalClass: "EffectUnsupportedError" as const };
      const held = await focusBeforeEffect(backend);
      const answer = await backend.clearElementText({ id });
      const note = await restoreFocusAfterEffect(backend, held, "clearing");
      return answer.element === undefined ? answer : { element: withFocusNote(answer.element, note) };
    },
  );
}

// THE POINTER (ADR-0078). Same gate order as the three keyboard verbs -
// authority, reach, then the vocabulary of what was given - and the same read
// back afterwards. Two things differ.
//
// The first is that no focus is borrowed. A press is how focus MOVES on a desk;
// grabbing focus before pressing would make the press land on something the
// daemon had just pulled to the front, which is not what the caller asked for
// and not what a person's click does.
//
// The second is that the vocabulary check here is arithmetic rather than a
// list: a button name, a count of one or two, and two fractions inside the
// element's own rectangle. The fractions are refused rather than clamped, for
// the reason every clamp in this file is refused - a clamped fraction is a
// press on the neighbour, reported as a press on the element.
//
// NOTHING CALLS THIS FUNCTION EXCEPT THE DISPATCH TABLE. In particular a
// refused activateElement does not fall back to it: an element that published
// no action has told the CALLER to decide whether to reach for the pointer, and
// a daemon that decided that on its own would be the fallback ADR-0046 clause 3
// forbids.
export function clickElement(
  params: { id?: unknown; button?: unknown; count?: unknown; x?: unknown; y?: unknown; capturedAt?: unknown },
  backend: Backend,
  launch: LaunchContext,
) {
  const id = typeof params.id === "string" ? params.id : "";
  return performEffect(
    "rawInput",
    "clickElement",
    rawInputScopeRefusal(launch.keys !== undefined, "clickElement"),
    launch,
    backend,
    id,
    async () => {
      if (launch.keys === undefined) return { refusal: NO_POINTER_ROUTE_REFUSAL, refusalClass: "EffectUnsupportedError" as const };
      const button = params.button === undefined ? "left" : params.button;
      if (typeof button !== "string" || !POINTER_BUTTON_NAMES.includes(button)) {
        return { refusal: unknownButtonRefusal(String(button)), refusalClass: "MalformedParameter" as const };
      }
      const count = params.count === undefined ? 1 : params.count;
      if (count !== 1 && count !== 2) return { refusal: unknownClickCountRefusal(count), refusalClass: "MalformedParameter" as const };
      const fractions: Array<["x" | "y", unknown]> = [
        ["x", params.x === undefined ? 0.5 : params.x],
        ["y", params.y === undefined ? 0.5 : params.y],
      ];
      for (const [axis, value] of fractions) {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
          return { refusal: outsideElementRefusal(axis, value), refusalClass: "MalformedParameter" as const };
        }
      }
      const [[, x], [, y]] = fractions as [["x", number], ["y", number]];
      // A press may name the picture it was aimed from. Carry that claim to the
      // backend, which is the only place that knows what was photographed and
      // where the element sits now (ADR-0107). A claim that is not a finite
      // number is refused here rather than silently dropped: a dropped claim
      // would press from an unchecked picture.
      const { capturedAt } = params;
      if (capturedAt !== undefined && (typeof capturedAt !== "number" || !Number.isFinite(capturedAt))) {
        return { refusal: unknownCapturedAtRefusal(capturedAt), refusalClass: "MalformedParameter" as const };
      }
      return backend.clickElement({ id, button, count, x, y, capturedAt });
    },
  );
}

export function typeText(params: { id?: unknown; text?: unknown }, backend: Backend, launch: LaunchContext) {
  const id = typeof params.id === "string" ? params.id : "";
  const text = typeof params.text === "string" ? params.text : "";
  return performEffect(
    "rawInput",
    "typeText",
    rawInputScopeRefusal(launch.keys !== undefined, "typeText"),
    launch,
    backend,
    id,
    async () => {
      if (launch.keys === undefined) return { refusal: NO_TYPE_ROUTE_REFUSAL, refusalClass: "EffectUnsupportedError" as const };
      const malformed = typeTextRefusal(text);
      if (malformed !== undefined) return { refusal: malformed, refusalClass: "MalformedParameter" as const };
      const held = await focusBeforeEffect(backend);
      const answer = await backend.typeText({ id, text });
      const note = await restoreFocusAfterEffect(backend, held, "typing");
      return answer.element === undefined ? answer : { element: withFocusNote(answer.element, note) };
    },
  );
}

// The dispatch table names every method the daemon serves, its effect class,
// and WHEN its enforcement runs. B11 (tools/pins/b11.mjs, wired in this same
// commit) reads this table from source and asserts every non-observe entry is
// marked "before-call" - result-time enforcement is legitimate only for
// observe, because filtering a response does not unsend the email. The
// enforcement TIMING itself is pinned by the ordering test in
// __tests__/launch-authority.test.ts; the pin and the test together are B11.
// Keep each entry on ONE line: b11.mjs parses entries line-by-line, and a
// multi-line entry would silently escape its scrutiny.
export type Handler = (params: unknown, backend: Backend, launch: LaunchContext, book?: SubscriptionBook) => Promise<unknown>;
export const DISPATCH: Record<string, { effectClass: string; enforcement: string; handler: Handler }> = {
  queryElements: { effectClass: "observe", enforcement: "at-result", handler: (p, b, l) => queryElements(p, b, l) },
  discoverElements: { effectClass: "observe", enforcement: "at-result", handler: (p, b, l) => discoverElements(p, b, l) },
  attestElement: { effectClass: "observe", enforcement: "at-result", handler: async (p, b, l) => observedWithConfiguration(await b.attestElement((p ?? {}) as never), b, l) },
  readElementContent: { effectClass: "observe", enforcement: "at-result", handler: async (p, b) => b.readElementContent((p ?? {}) as never) },
  // Observation remains gated by the named semantic element. Native capture
  // crops visible root-display pixels to its bounds, so overlapping windows may
  // appear: application grants do not promise per-application pixel isolation
  // (ADR-0093).
  captureElement: {
    effectClass: "observe",
    enforcement: "at-result",
    handler: async (p, b) => {
      try {
        return await b.captureElement((p ?? {}) as never);
      } catch (failure) {
        // Answered in this method's OWN refusal field rather than left to the
        // generic unreadable-desktop reply, because the two say different
        // things to a caller: "the desk cannot be read" is a reason to stop,
        // and "this element has no rectangle" is a reason to look at a
        // different element. Collapsing them would spend turns on the wrong
        // recovery.
        if (failure instanceof UnperformableElementError || failure instanceof EffectUnsupportedError) {
          return { refusal: failure.message, refusalClass: failure.constructor.name as RefusalClass };
        }
        throw failure;
      }
    },
  },
  subscribeElement: { effectClass: "observe", enforcement: "at-result", handler: (p, b, _l, k) => subscribeElement((p ?? {}) as never, b, k) },
  unsubscribeElement: { effectClass: "observe", enforcement: "at-result", handler: (p, _b, _l, k) => unsubscribeElement((p ?? {}) as never, k) },
  openApplication: { effectClass: "activate", enforcement: "before-call", handler: (p, b, l) => openApplication((p ?? {}) as { name?: string }, b, l) },
  editElement: { effectClass: "edit", enforcement: "before-call", handler: (p, b, l) => editElement((p ?? {}) as { id?: unknown; value?: unknown }, b, l) },
  activateElement: { effectClass: "activate", enforcement: "before-call", handler: (p, b, l) => activateElement((p ?? {}) as { id?: unknown; action?: unknown }, b, l) },
  submitElement: { effectClass: "submit", enforcement: "before-call", handler: (p, b, l) => submitElement((p ?? {}) as { id?: unknown; attestation?: unknown }, b, l) },
  setElementValue: { effectClass: "edit", enforcement: "before-call", handler: (p, b, l) => setElementValue((p ?? {}) as { id?: unknown; value?: unknown }, b, l) },
  setElementText: { effectClass: "edit", enforcement: "before-call", handler: (p, b, l) => setElementText((p ?? {}) as { id?: unknown; text?: unknown; offset?: unknown }, b, l) },
  setElementCaret: { effectClass: "edit", enforcement: "before-call", handler: (p, b, l) => setElementCaret((p ?? {}) as { id?: unknown; offset?: unknown }, b, l) },
  revealElement: { effectClass: "activate", enforcement: "before-call", handler: (p, b, l) => revealElement((p ?? {}) as { id?: unknown }, b, l) },
  sendKeyChord: { effectClass: "rawInput", enforcement: "before-call", handler: (p, b, l) => sendKeyChord((p ?? {}) as { id?: unknown; chord?: unknown }, b, l) },
  typeText: { effectClass: "rawInput", enforcement: "before-call", handler: (p, b, l) => typeText((p ?? {}) as { id?: unknown; text?: unknown }, b, l) },
  clickElement: { effectClass: "rawInput", enforcement: "before-call", handler: (p, b, l) => clickElement((p ?? {}) as { id?: unknown }, b, l) },
  clearElementText: { effectClass: "rawInput", enforcement: "before-call", handler: (p, b, l) => clearElementText((p ?? {}) as { id?: unknown }, b, l) },
  listApplications: { effectClass: "observe", enforcement: "at-result", handler: (_p, b, l) => listApplications(b, l) },
  describeAccessibility: { effectClass: "observe", enforcement: "at-result", handler: (_p, _b, l) => describeAccessibility(l) },
  // Machine-scoped like describeAccessibility, and for the same reason it is
  // not gated per-application: it names no application and answers nothing an
  // application published (ADR-0082).
  describeDesktop: { effectClass: "observe", enforcement: "at-result", handler: async () => describeDesktop() },
  // Its own effect class, not one of the five capability names, because it is
  // not a capability: it is machine-scoped, and the capability list is
  // per-application and exhaustive (ADR-0064 clause 4). The class still gates
  // it before the call, which is what B11 is about.
  acquireAccessibility: { effectClass: "acquire", enforcement: "before-call", handler: (_p, _b, l) => auditedAcquire(l) },
  // Its own effect class for the same reason acquire has one: restart
  // authority is four levels in a sibling configuration section, not a
  // capability boolean (ADR-0065 clause 3), so none of the five capability
  // names describes it. The class still gates it before the call.
  restartApplication: { effectClass: "restart", enforcement: "before-call", handler: (p, b, l) => restartApplication((p ?? {}) as { name?: string }, b, l) },
};

export interface Request {
  type: "request";
  id: number;
  method: string;
  params?: unknown;
}

export interface HandledResponse {
  type: "response";
  id: number;
  result?: unknown;
}

// Every refusal leaves the daemon the same way: inside the result, with its
// owner and code (ADR-0113). A route's own refusal gets there through
// withoutInternals; the routing refusals below are built here.
// Fail-closed, second half (ADR-0026 amended): the effect happened and its
// receipt did not. The effect cannot be undone, so the caller is told on the
// element the result names, through the diagnostic channel ADR-0056 reserves
// for exactly this kind of daemon-side note. A result naming no element still
// has the operator's stderr line from the sink.
export const AUDIT_UNWRITTEN_NOTE =
  "mastra-cc/audit-unwritten: this effect was performed but its audit entry could not be written; the operator's log has the reason";
export function markUnwrittenReceipt(result: unknown): void {
  for (const key of ["element", "application"]) {
    const named = (result as Record<string, unknown> | undefined)?.[key];
    if (named !== null && typeof named === "object") {
      const element = named as { diagnostic?: Record<string, string> };
      element.diagnostic = { ...element.diagnostic, "mastra-cc/audit-unwritten": AUDIT_UNWRITTEN_NOTE };
    }
  }
}

export const AUDIT_UNWRITABLE_REFUSAL =
  "refused before anything was touched: the audit log cannot be written, and an effect this daemon could not record is an effect it does not perform (ADR-0026) - the operator must repair the log's path or permissions";

export function refusedResponse(id: number, code: RefusalClass, message: string): HandledResponse {
  return { type: "response", id, result: { refusal: refusalOf(code, message) } };
}

// WHAT "TOUCHED" MEANS, DECIDED HERE. A query walks the tree - up to 150 nodes
// in an application and 2500 across the desktop - and ANSWERS the few that
// matched. The record names what was answered, not what was walked, and it says
// so out loud because the two are genuinely different claims: recording every
// walked node would put the accessible name of nearly every element on the
// desktop into an access record whose whole point is restraint, and it would
// make the record's size track the desktop's size rather than the reader's
// access. The consequence is stated rather than hidden: an element a query
// walked past and discarded leaves no entry.
//
// A watch answers no element in its result shape, so subscribe and unsubscribe
// state theirs directly (auditElement), which is why this reads both.
// The elements travel WHOLE from here; audit.ts narrows them to identity on
// the way to the disk, in one place, rather than each route remembering to.
export function answeredElements(result: unknown): AuditSubject[] {
  if (result === null || typeof result !== "object") return [];
  const answer = result as Classified<{ elements?: SemanticElement[]; element?: SemanticElement }>;
  if (answer.auditElement !== undefined) return answer.auditElement;
  if (answer.elements !== undefined) return answer.elements;
  if (answer.element !== undefined) return [answer.element];
  return [];
}

// A read that answered is `read`; one that refused is named by its class. The
// distinction matters to an auditor in the one direction that counts: whether
// anything was actually seen.
export function observeOutcome(result: unknown): string {
  if (result === null || typeof result !== "object") return READ;
  const answer = result as Classified<{ refusal?: string }>;
  return answer.refusal === undefined ? READ : refused(answer.refusalClass);
}

export async function handleRequest(
  request: Request,
  backend: Backend,
  launch: LaunchContext = NO_PERMITS,
  book?: SubscriptionBook,
  driver?: { authority: DriverAuthority; connection: DriverConnection },
): Promise<HandledResponse> {
  const entry = Object.hasOwn(DISPATCH, request.method) ? DISPATCH[request.method] : undefined;
  if (!entry) {
    return refusedResponse(request.id, "UnknownMethod",
      `refused by the effect-class gate: "${request.method}" is not a method of ` +
      `schema v${PROTOCOL_VERSION} - the daemon serves what the schema defines and nothing else`);
    // No receipt: a method the schema does not define reaches no route and
    // touches nothing, so there is no access to record. The refusal still has
    // a class (UnknownMethod) because the vocabulary is closed over what this
    // daemon refuses, not over what it happens to write down.
  }
  // A non-observe entry without before-call enforcement is unrepresentable in
  // the table above (B11 reads the source to keep it that way); this check is
  // the runtime backstop with the same refusal shape.
  if (entry.effectClass !== "observe" && entry.enforcement !== "before-call") {
    return refusedResponse(request.id, "EnforcementUnrepresentable",
      `refused by the effect-class gate: "${request.method}" is ${entry.effectClass}-class but not marked for before-call enforcement`);
    // No receipt, same reason: the backstop fires before the handler runs
    // (class EnforcementUnrepresentable).
  }
  const ownershipRefusal = driver?.authority.refusal(driver.connection, entry.effectClass !== "observe");
  if (ownershipRefusal !== undefined) return refusedResponse(request.id, ownershipRefusal === DRIVER_CLOSED ? "DriverClosed" : "DriverBusy", ownershipRefusal);
  // Fail-closed, first half (ADR-0026 amended): an effect whose receipt could
  // not be written is refused before anything is touched.
  if (entry.effectClass !== "observe" && !auditWritable()) {
    return refusedResponse(request.id, "AuditUnwritable", AUDIT_UNWRITABLE_REFUSAL);
  }
  const unwrittenBefore = unwrittenEffectEntries();
  try {
    const result = await serialised<unknown>(targetOf(request.params, backend), async () => {
      const retired = driver?.authority.enter(driver.connection, entry.effectClass !== "observe");
      if (retired !== undefined) return { refusal: retired, refusalClass: retired === DRIVER_CLOSED ? "DriverClosed" : "DriverBusy" };
      // Audit identity belongs to this request. Event origin is a separate question.
      try {
        const run = () => operation.run(entry.effectClass === "observe" ? undefined : { causeId: mintCauseId() },
          () => entry.handler(request.params, backend, launch, book));
        // The driver's disconnect is its cancellation request; the signal
        // reaches the backend's emission boundaries through this store.
        return await (driver === undefined ? run() : underCancellation(driver.connection.signal, run));
      } finally {
        driver?.authority.leave(driver.connection);
      }
    });
    // THE THIRD AUDIT CALL SITE, and the one the artifact turns on. ADR-0026's
    // own defining example of an access record is a READ - "the subject field
    // of the third message was read" - so a log recording only effects would
    // answer an audit of a reading session with an empty file. All observe-class
    // methods write from this ONE point, deliberately: per-handler entries are
    // places where a new observation route can be forgotten.
    //
    // The effect routes are excluded because they already wrote, in the places
    // that know which scope they were permitted under; a second entry here
    // would double every effect in the record.
    if (entry.effectClass === "observe") {
      const application = (result as { auditApplication?: string }).auditApplication;
      recordAudit({ application, element: answeredElements(result), scope: "observe", cause: causeOf(application), outcome: observeOutcome(result) });
    }
    const answered = withoutInternals(result);
    if (unwrittenEffectEntries() > unwrittenBefore) markUnwrittenReceipt(answered);
    return { type: "response", id: request.id, result: answered };
  } catch (error) {
    // Whatever the backend threw stays on this side of the wire; the client
    // gets one honest constant, never the raw error (98ac7fd's lesson). The
    // operator's own stderr gets the cause - name and message, never the
    // params - because a failure that is invisible everywhere is a failure
    // that has to be diagnosed by patching the bundle (ADR-0071). This line is
    // the daemon's log, not the audit record: the record keeps its no-prose
    // discipline. The attempt is still recorded: an access the daemon could
    // not complete is a fact about access, and a record that keeps only the
    // tidy cases is a record of the tidy cases.
    // Subclasses here do not set .name (IncompleteObservationError reads as
    // "Error" through it), so the class name is what gets written.
    const name = error instanceof Error ? error.constructor.name || error.name : "Error";
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof CancelledAtBoundaryError) {
      // Not a failure: the driver asked, and the effect stopped where stopping
      // was honest. The count is the uncertain-outcome marker the plan asks for.
      console.error(`daemon: ${request.method} ${message}`);
    } else {
      console.error(`daemon: ${request.method} failed in the backend: ${name}: ${message}`);
    }
    if (error instanceof CallDeadlineError && entry.effectClass === "observe") {
      recordAudit({ application: undefined, element: [], scope: "observe", cause: causeOf(undefined), outcome: refused("DeadlineExceeded") });
      return refusedResponse(request.id, "DeadlineExceeded", deadlineRefusal(error, false));
    }
    if (error instanceof DialogBlockingError && entry.effectClass === "observe") {
      recordAudit({ application: undefined, element: [], scope: "observe", cause: causeOf(undefined), outcome: refused("BlockedByDialog") });
      return refusedResponse(request.id, "BlockedByDialog", dialogRefusal(error, false));
    }
    if (entry.effectClass === "observe") {
      recordAudit({ application: undefined, element: [], scope: "observe", cause: causeOf(undefined), outcome: FAILED });
    }
    if (error instanceof ElementGoneError) {
      return refusedResponse(request.id, "ElementGone", ELEMENT_GONE_REFUSAL);
    }
    if (error instanceof PeerGoneError) {
      return refusedResponse(request.id, "ApplicationGone", APPLICATION_GONE_REFUSAL);
    }
    return refusedResponse(request.id, "BackendUnreadable", BACKEND_UNREADABLE_REFUSAL);
  }
}

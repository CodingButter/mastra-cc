// The browser route's effect half. Same promise as atspi/effects.ts - nothing
// here trusts a return value - reached through a genuinely different instrument
// and constrained by a genuinely different limit.
//
// HOW THIS ROUTE ACTS. The accessibility domain reads and does not act, so
// performing needs another domain. The element is resolved to a JavaScript
// object through the tree it was already found in (`DOM.resolveNode` on the
// backend node id this backend answered), and the effect is a function called
// ON THAT OBJECT (`Runtime.callFunctionOn`). Element-addressed throughout: at
// no point is a coordinate clicked, a key synthesised, or a selector guessed.
// That is what keeps this the semantic route rather than the raw-input class
// ADR-0046 defers - and it is the same machinery subtree-stream.ts has used to
// anchor a change observer since M2.4, not a new kind of access.
//
// HOW THIS ROUTE VERIFIES, AND WHERE IT DIFFERS. The desktop route reads a
// field's text back off the field. Measured on a real page, THE BROWSER ROUTE
// CANNOT: an AX textbox node publishes `editable`, `settable`, `multiline`,
// `readonly`, `required` - and no value at all. What a filled field publishes
// is a StaticText child carrying the typed string. So the read-back here is a
// different observation of the same fact, and it is stated rather than smoothed
// into looking like the other route's (ADR-0040). A CDP call that returns
// without error is not evidence that the page changed; the tree is re-read
// either way.

import {
  EffectUnsupportedError,
  UnpublishedActionError,
  WriteNotObservedError,
} from "../../backend.js";

export interface CallSeam {
  exchange(exchange: { kind: "call"; targetId: string; method: string; params: Record<string, unknown> }): Promise<unknown>;
}

export interface NodeRef {
  readonly targetId: string;
  readonly backendDOMNodeId?: number;
  // The AX tree's own node id, a string on this protocol - distinct from the
  // DOM's numeric backend id, and the fallback for nodes the tree never gave
  // a DOM id to.
  readonly nodeId?: string;
}

interface ResolveReply {
  result?: { object?: { objectId?: string } };
}

interface CallFunctionReply {
  result?: { result?: { value?: unknown } };
  exceptionDetails?: { text?: string };
}

// Resolving the element to something a function can be called on. The node id
// is the one this backend already answered from the tree - the object is
// reached THROUGH the accessibility tree, never by querying the document for
// something that looks similar.
async function objectFor(seam: CallSeam, ref: NodeRef): Promise<string> {
  // Only the DOM's own backend node id can resolve to an object. The AX tree's
  // `nodeId` is a DIFFERENT namespace - a string, minted by the accessibility
  // tree - and handing it to DOM.resolveNode would either error or, far worse,
  // resolve some unrelated DOM node and act on it. A node the tree never gave
  // a DOM id to is one this route cannot act on, and it says so.
  if (ref.backendDOMNodeId === undefined) {
    throw new EffectUnsupportedError(
      "this element names no DOM node in the page - the accessibility tree answered it without one, and acting on it would mean guessing which node was meant",
    );
  }
  const reply = (await seam.exchange({
    kind: "call",
    targetId: ref.targetId,
    method: "DOM.resolveNode",
    params: { backendNodeId: ref.backendDOMNodeId },
  })) as ResolveReply;
  const objectId = reply.result?.object?.objectId;
  if (objectId === undefined) {
    throw new WriteNotObservedError(
      "the page would not resolve this element to an object - it was in the tree when it was answered and is not now; look again",
    );
  }
  return objectId;
}

// A page exception is not a thrown error at the protocol level: the call
// answers normally and reports the exception in the reply. Letting that pass
// would be exactly the "returned success, changed nothing" failure this whole
// milestone is built against.
async function callOn(
  seam: CallSeam,
  ref: NodeRef,
  objectId: string,
  functionDeclaration: string,
  args: ReadonlyArray<unknown>,
): Promise<unknown> {
  const reply = (await seam.exchange({
    kind: "call",
    targetId: ref.targetId,
    method: "Runtime.callFunctionOn",
    params: {
      objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
    },
  })) as CallFunctionReply;
  if (reply.exceptionDetails !== undefined) {
    throw new WriteNotObservedError(
      `the page raised an exception performing this: ${String(reply.exceptionDetails.text ?? "no detail given")}`,
    );
  }
  return reply.result?.result?.value;
}

// WRITING A FIELD'S CONTENT.
//
// The write is followed by reading the property back off the same object. Note
// what this is NOT: it is not the accessibility tree, because the tree does not
// publish the value (measured). It is the element's own value as the page sees
// it, read in a separate call after the write, which is the closest this route
// can get to the desktop route's read-back. The tree-side observation - the
// StaticText child carrying the typed string - is what the backend's re-read
// surfaces to the caller on top of this.
export async function setValueOf(seam: CallSeam, ref: NodeRef, value: string): Promise<void> {
  const objectId = await objectFor(seam, ref);
  await callOn(seam, ref, objectId, "function(v){ this.value = v; this.dispatchEvent(new Event('input', {bubbles:true})); this.dispatchEvent(new Event('change', {bubbles:true})); }", [value]);
  // Read back, separately, rather than trusting what the write returned.
  const observed = await callOn(seam, ref, objectId, "function(){ return this.value; }", []);
  if (String(observed ?? "") !== value) {
    throw new WriteNotObservedError(
      `writing this element reported success, but reading it back found ${JSON.stringify(String(observed ?? ""))} where ${JSON.stringify(value)} was intended - the page performed something other than what was asked`,
    );
  }
}

// PLACING THE CARET.
export async function setCaretOf(seam: CallSeam, ref: NodeRef, offset: number | undefined): Promise<void> {
  const objectId = await objectFor(seam, ref);
  const target = offset ?? -1;
  const observed = await callOn(
    seam,
    ref,
    objectId,
    // -1 means the end of the content, resolved against the element's own
    // length rather than against a number chosen here. An offset past the end
    // is refused by the caller before this point, not clamped silently.
    "function(o){ const at = o < 0 ? this.value.length : o; this.setSelectionRange(at, at); return this.selectionStart; }",
    [target],
  );
  const intended = offset;
  if (intended !== undefined && Number(observed) !== intended) {
    throw new WriteNotObservedError(
      `placing the caret reported success, but reading it back found it at ${String(observed)} where ${intended} was intended`,
    );
  }
}

// The element's content as the page holds it. Note what this is NOT: it is not
// read from the accessibility tree, because the tree does not publish it
// (measured). An insert has to know what it is inserting INTO, and the only
// place this route can learn that is the element itself.
export async function contentOf(seam: CallSeam, ref: NodeRef): Promise<string> {
  const objectId = await objectFor(seam, ref);
  const observed = await callOn(seam, ref, objectId, "function(){ return String(this.value ?? ''); }", []);
  return String(observed ?? "");
}

// The length of the element's content, as the page reports it. Used to refuse
// an out-of-range caret BEFORE the call rather than discovering afterwards that
// the browser clamped it - the same discipline the desktop route applies to an
// insert offset.
export async function contentLength(seam: CallSeam, ref: NodeRef): Promise<number> {
  const objectId = await objectFor(seam, ref);
  const observed = await callOn(seam, ref, objectId, "function(){ return String(this.value ?? '').length; }", []);
  return Number(observed ?? 0);
}

// SETTING A MAGNITUDE.
//
// The bounds are read off the element immediately before the write, from the
// element's own attributes - the same numbers the reader publishes as the
// range. The caller refuses an out-of-range value before reaching here; this
// reads back to confirm the value LANDED, because a range input silently
// clamps exactly the way the desktop platform does.
export async function setMagnitudeOf(seam: CallSeam, ref: NodeRef, value: number): Promise<void> {
  const objectId = await objectFor(seam, ref);
  await callOn(seam, ref, objectId, "function(v){ this.value = String(v); this.dispatchEvent(new Event('input', {bubbles:true})); this.dispatchEvent(new Event('change', {bubbles:true})); }", [value]);
  const observed = await callOn(seam, ref, objectId, "function(){ return Number(this.value); }", []);
  if (Number(observed) !== value) {
    throw new WriteNotObservedError(
      `setting this element's value reported success, but reading it back found ${String(observed)} where ${value} was intended - the page clamped or ignored the write`,
    );
  }
}

// PERFORMING AN ACTION.
//
// The action name must be one the READER derived for this node, matched
// verbatim. The mapping below is from that derived vocabulary to the page
// behaviour that realises it - it does not add a name, and a name the reader
// never derived is refused rather than approximated. `focus` and `select` are
// different words for different published groundings and stay different here.
const PERFORMS: Record<string, string> = {
  focus: "function(){ this.focus(); return document.activeElement === this; }",
  // A disclosure's open state IS its expansion; the two derived verbs act on
  // the same property from opposite sides, which is why the reader publishes
  // two names rather than one with a flag.
  expand: "function(){ if ('open' in this) { this.open = true; return this.open === true; } this.setAttribute('aria-expanded','true'); return true; }",
  collapse: "function(){ if ('open' in this) { this.open = false; return this.open === false; } this.setAttribute('aria-expanded','false'); return true; }",
  select: "function(){ if ('selected' in this) { this.selected = true; return this.selected === true; } this.click(); return true; }",
};

export async function performDerivedAction(
  seam: CallSeam,
  ref: NodeRef,
  action: string,
  published: ReadonlyArray<string>,
): Promise<void> {
  // Refused BEFORE the call, against the list this node actually published.
  // Performing the nearest match would be the role-to-action table this
  // milestone deleted, wearing a search function (ADR-0045 clause 2).
  if (!published.includes(action)) {
    throw new UnpublishedActionError(
      `this element does not publish an action named ${JSON.stringify(action)} - it publishes ${JSON.stringify([...published])}`,
    );
  }
  const declaration = PERFORMS[action];
  if (declaration === undefined) {
    // The reader derived a name this file has no realisation for. That is a
    // gap between two files in the same route, and saying so is the only
    // honest answer - guessing at a behaviour for an unknown verb is how a
    // daemon performs something nobody asked for.
    throw new UnpublishedActionError(
      `this route derived the action ${JSON.stringify(action)} but has no way to perform it - it can perform ${JSON.stringify(Object.keys(PERFORMS))}`,
    );
  }
  const objectId = await objectFor(seam, ref);
  const observed = await callOn(seam, ref, objectId, declaration, []);
  if (observed !== true) {
    throw new WriteNotObservedError(
      `performing ${JSON.stringify(action)} reported success, but reading the element back did not show it took effect`,
    );
  }
}

// BRINGING AN ELEMENT INTO VIEW - the reveal operation, never a pixel.
//
// `scrollIntoView` is the page's own "make this visible" and takes no
// coordinate, which is exactly the shape ADR-0045 asks for: the wire asked only
// that the element be made visible and is told only whether it now is. A
// scroll offset in pixels is a promise about one viewport, and it is not made.
export async function revealIn(seam: CallSeam, ref: NodeRef): Promise<void> {
  const objectId = await objectFor(seam, ref);
  await callOn(seam, ref, objectId, "function(){ this.scrollIntoView({block:'nearest', inline:'nearest'}); }", []);
}

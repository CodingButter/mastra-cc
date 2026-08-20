// Performing, on the accessibility bus. The reader in actions.ts asks an
// element what it can do; this file does it - and nothing here decides what an
// element is capable of. Every verb is performed through an interface the
// element itself publishes, and an element that does not publish the interface
// gets `not-exposed` rather than an error dressed as policy (ADR-0045).
//
// The split between the two halves of this file is ADR-0045's. An ACTION is a
// bare verb performed BY INDEX - `DoAction(in index:i) -> b` is the whole input
// surface, so there is nowhere to put a magnitude even if we wanted one. An
// OPERATION carries a typed argument, expressed here in the units this platform
// uses, bounded by the range the ELEMENT published. Pixels and enum constants
// exist in this file and nowhere above it.

import {
  MagnitudeOutOfRangeError,
  OperationNotExposedError,
  TextOffsetOutOfRangeError,
  UnpublishedActionError,
  WriteNotObservedError,
} from "../../backend.js";
import { UnrecordedExchangeError } from "./channel.js";
import { toNeutralStates } from "./roles.js";

interface CallSeam {
  call(exchange: {
    destination: string;
    path: string;
    iface: string;
    member: string;
    signature?: string;
    body?: unknown[];
  }): Promise<unknown[]>;
}

export interface NativeRef {
  busName: string;
  objectPath: string;
}

const ACCESSIBLE_IFACE = "org.a11y.atspi.Accessible";
const ACTION_IFACE = "org.a11y.atspi.Action";
const COMPONENT_IFACE = "org.a11y.atspi.Component";
const EDITABLE_TEXT_IFACE = "org.a11y.atspi.EditableText";
const PROPERTIES_IFACE = "org.freedesktop.DBus.Properties";
const TEXT_IFACE = "org.a11y.atspi.Text";
const VALUE_IFACE = "org.a11y.atspi.Value";

// `Component.ScrollTo(in type:u)`, ANYWHERE. The enum is this platform's, and
// this constant is the furthest up it travels: the wire asks "make this
// visible" and says nothing about where on the screen it lands, because
// top-left on one machine is off-screen on another. ScrollToPoint's pixels are
// deliberately not used - a coordinate is a promise about one screen.
const SCROLL_ANYWHERE = 6;

// dbus-native hands a variant back either unwrapped (observed live on this
// machine) or as a [signature, [value]] pair. Both shapes appear; accept both.
function unwrapVariant(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  const inner = raw[1];
  return Array.isArray(inner) ? inner[0] : inner;
}

async function propertyOf(seam: CallSeam, ref: NativeRef, iface: string, name: string): Promise<unknown> {
  const [raw] = await seam.call({
    destination: ref.busName,
    path: ref.objectPath,
    iface: PROPERTIES_IFACE,
    member: "Get",
    signature: "ss",
    body: [iface, name],
  });
  return unwrapVariant(raw);
}

// The pre-flight every operation runs first. It is the same question the action
// reader asks, for the same reason: an element that errors when asked about an
// interface it does not have becomes an unrecorded exchange on replay, and the
// only ways out of that are to relax replay's refusal or to invent an answer.
export async function interfacesOf(seam: CallSeam, ref: NativeRef): Promise<string[]> {
  const [raw] = await seam.call({
    destination: ref.busName,
    path: ref.objectPath,
    iface: ACCESSIBLE_IFACE,
    member: "GetInterfaces",
  });
  return Array.isArray(raw) ? raw.map((entry) => String(entry)) : [];
}

async function requireInterface(seam: CallSeam, ref: NativeRef, iface: string, operation: string): Promise<void> {
  const interfaces = await interfacesOf(seam, ref);
  if (interfaces.includes(iface)) return;
  // not-exposed. Nothing was withheld and nothing was configured off - the
  // element does not publish the capability. Saying this in a policy shape
  // would teach the caller that some setting could change the answer, which is
  // the false belief ADR-0042 exists to kill.
  throw new OperationNotExposedError(
    `this element does not expose ${operation} - the platform never offered it here, and no setting of ours turned it off`,
  );
}

// PERFORMING AN ACTION.
//
// The name is re-read per index immediately before performing, never taken from
// the bulk reply. Measured on this machine: of 263 elements publishing actions,
// bulk GetActions returned empty name strings on 10 while per-index GetName
// answered the real word every time. Performing "the action the bulk list said
// was at index 2" is performing something nobody named.
//
// A name the element did not publish is refused rather than approximated. There
// is no nearest match here on purpose: click, doDefault and activate are three
// different verbs, and choosing between them on the caller's behalf is the
// role-to-action table this milestone deleted, wearing a search function.
//
// The DoAction reply is returned, and the asymmetry is deliberate. A `true` is
// worth nothing: this platform answers true for writes it clamped elsewhere and
// for window moves that moved nothing, which is why every caller here verifies
// by re-reading instead. A `false` is worth something quite different - it is
// the platform declining, in its own words, before anything happened. Reading
// the world back cannot recover that fact, because a decline leaves the world
// exactly as it was, which is indistinguishable from an effect not yet visible.
// So the reply is carried out of here as evidence of REFUSAL only, and never as
// evidence of success.
export async function performAction(seam: CallSeam, ref: NativeRef, action: string): Promise<boolean> {
  await requireInterface(seam, ref, ACTION_IFACE, "actions");

  const [rawCount] = await seam.call({
    destination: ref.busName,
    path: ref.objectPath,
    iface: ACTION_IFACE,
    member: "GetActions",
  });
  const count = Array.isArray(rawCount) ? rawCount.length : 0;

  const seen: string[] = [];
  for (let index = 0; index < count; index += 1) {
    let named: unknown;
    try {
      [named] = await seam.call({
        destination: ref.busName,
        path: ref.objectPath,
        iface: ACTION_IFACE,
        member: "GetName",
        signature: "i",
        body: [index],
      });
    } catch (error) {
      // An action that will not name itself cannot be the one that was asked
      // for: the request names a word, and this index has none to match it
      // against. Skipped rather than guessed at.
      if (error instanceof UnrecordedExchangeError) throw error;
      continue;
    }
    const name = String(named ?? "");
    seen.push(name);
    if (name !== action) continue;
    const [performed] = await seam.call({
      destination: ref.busName,
      path: ref.objectPath,
      iface: ACTION_IFACE,
      member: "DoAction",
      signature: "i",
      body: [index],
    });
    // Anything that is not an explicit false is treated as "the platform did
    // not decline" - never as "the platform succeeded". A tape or a platform
    // that answers nothing at all has declined nothing.
    return performed !== false;
  }

  throw new UnpublishedActionError(
    `this element does not publish an action named ${JSON.stringify(action)} - it publishes ${JSON.stringify(seen)}`,
  );
}

async function characterCount(seam: CallSeam, ref: NativeRef): Promise<number> {
  return Number(await propertyOf(seam, ref, TEXT_IFACE, "CharacterCount"));
}

// READING A FIELD'S TEXT, THE WAY THE WIRE ACTUALLY ANSWERS IT.
//
// `GetText(0, -1)` is a convenience the language bindings offer, not something
// the bus implements: over the wire that call answers an empty string. A reader
// that used it would see every field as empty, and a self-verify loop built on
// that reading would re-type into an already-full field and call it a fix
// (docs/proofs/can-node-act-on-the-desktop.md). The end offset is therefore
// asked for first, as a number the element itself published.
export async function textOf(seam: CallSeam, ref: NativeRef): Promise<string> {
  const length = await characterCount(seam, ref);
  const [text] = await seam.call({
    destination: ref.busName,
    path: ref.objectPath,
    iface: TEXT_IFACE,
    member: "GetText",
    signature: "ii",
    body: [0, length],
  });
  return String(text ?? "");
}

// The step that turns a return value into evidence. The platform's failure mode
// is not an error: it is a write that lands somewhere else and answers true. So
// after every write, the field is read back the way the wire answers, and what
// it holds is compared against what the write intended. A disagreement is
// raised - never absorbed, never retried into place.
//
// The sentence is written once, here, and every operation in this file uses it.
// An operation that re-read without comparing would produce a fresh, honest-
// looking reading of an element the write may never have touched, which is the
// same false belief as reporting the platform's own `true` (ADR-0047).
function observed(what: string, observedValue: unknown, intended: unknown): WriteNotObservedError {
  return new WriteNotObservedError(
    `${what} reported success, but reading the element back found ${JSON.stringify(observedValue)} where ${JSON.stringify(intended)} was intended - the platform performed something other than what was asked`,
  );
}

async function observeWrite(seam: CallSeam, ref: NativeRef, intended: string, what: string): Promise<void> {
  const found = await textOf(seam, ref);
  if (found === intended) return;
  throw observed(what, found, intended);
}

// REPLACING A FIELD'S CONTENT.
export async function setTextContents(seam: CallSeam, ref: NativeRef, value: string): Promise<void> {
  await requireInterface(seam, ref, EDITABLE_TEXT_IFACE, "editing its text");
  await seam.call({
    destination: ref.busName,
    path: ref.objectPath,
    iface: EDITABLE_TEXT_IFACE,
    member: "SetTextContents",
    signature: "s",
    body: [value],
  });
  await observeWrite(seam, ref, value, "replacing this element's text");
}

// INSERTING TEXT AT AN OFFSET.
//
// The bounds check happens BEFORE the call, and it is not defensive
// programming: measured on this machine, an insert at offset 99999 into a
// nine-character field was clamped to the end, performed, and reported success.
// A write that lands somewhere other than where it was aimed is a wrong write,
// and the platform will not tell us it happened.
export async function insertText(seam: CallSeam, ref: NativeRef, text: string, offset: number): Promise<void> {
  await requireInterface(seam, ref, EDITABLE_TEXT_IFACE, "editing its text");
  const before = await textOf(seam, ref);
  if (offset < 0 || offset > before.length) {
    throw new TextOffsetOutOfRangeError(
      `offset ${offset} is outside this element's text, which holds ${before.length} characters - refused rather than moved to the end`,
    );
  }
  await seam.call({
    destination: ref.busName,
    path: ref.objectPath,
    iface: EDITABLE_TEXT_IFACE,
    member: "InsertText",
    signature: "sis",
    body: [offset, text, text.length],
  });
  // The intent is stated in full - the text as it should read afterwards - so
  // the comparison catches an insert that landed at a different offset, not
  // merely one that vanished. A clamped insert produces the right characters in
  // the wrong place, and only a whole-content comparison can see that.
  await observeWrite(seam, ref, before.slice(0, offset) + text + before.slice(offset), "inserting into this element");
}

// PLACING THE CARET. Same bounds reasoning as the insert above: the platform
// clamps silently, so the refusal has to happen on this side of the call.
export async function setCaretOffset(seam: CallSeam, ref: NativeRef, offset?: number): Promise<void> {
  await requireInterface(seam, ref, TEXT_IFACE, "a text insertion point");
  const length = await characterCount(seam, ref);
  const target = offset ?? length;
  if (target < 0 || target > length) {
    throw new TextOffsetOutOfRangeError(
      `offset ${target} is outside this element's text, which holds ${length} characters - refused rather than moved to the end`,
    );
  }
  await seam.call({
    destination: ref.busName,
    path: ref.objectPath,
    iface: TEXT_IFACE,
    member: "SetCaretOffset",
    signature: "i",
    body: [target],
  });
  // The caret is a number the element publishes about itself, so the same
  // read-back the text writes use is available here and is taken. A caret that
  // was refused a move lands somewhere else and the platform says nothing.
  const landed = Number(await propertyOf(seam, ref, TEXT_IFACE, "CaretOffset"));
  if (landed !== target) throw observed("placing this element's caret", landed, target);
}

// MOVING A MAGNITUDE.
//
// The bounds come from the element, every time, immediately before the write.
// Nothing here converts a percentage into anything: a magnitude arrives in the
// units the element published and is compared against the range the element
// published, or it is refused. There is no unit in this function that the
// element did not name first (ADR-0045 clause 4).
export async function setValue(seam: CallSeam, ref: NativeRef, value: number): Promise<void> {
  await requireInterface(seam, ref, VALUE_IFACE, "a magnitude");
  const minimum = Number(await propertyOf(seam, ref, VALUE_IFACE, "MinimumValue"));
  const maximum = Number(await propertyOf(seam, ref, VALUE_IFACE, "MaximumValue"));
  if (value < minimum || value > maximum) {
    throw new MagnitudeOutOfRangeError(
      `${value} is outside the range this element published (${minimum} to ${maximum}) - refused rather than clamped into a lie`,
    );
  }
  await seam.call({
    destination: ref.busName,
    path: ref.objectPath,
    iface: PROPERTIES_IFACE,
    member: "Set",
    signature: "ssv",
    body: [VALUE_IFACE, "CurrentValue", ["d", value]],
  });
  // The measured failure this catches: the platform clamps a magnitude to a
  // step it never published, performs it, and reports nothing. The range check
  // above cannot see that - it knows only what was asked, not what landed.
  const landed = Number(await propertyOf(seam, ref, VALUE_IFACE, "CurrentValue"));
  if (landed !== value) throw observed("moving this element's magnitude", landed, value);
}

// GIVING AN ELEMENT THE FOCUS BACK (ADR-0044).
//
// Component.GrabFocus is the accessibility bus's own route, which means it goes
// through the APPLICATION rather than through the compositor - the deliberate
// choice of the two ADR-0044 named, because the other one is a compositor
// protocol this project does not depend on (07-ROADMAP §8).
//
// The reply is discarded on purpose, and this is the same asymmetry the rest of
// this file lives by: on this session type SetPosition returns true and moves
// nothing, so a GrabFocus that returns true has claimed something rather than
// shown it. Whether focus actually moved is decided by the caller reading the
// focused element back out of the tree, never here.
export async function grabFocus(seam: CallSeam, ref: NativeRef): Promise<void> {
  await requireInterface(seam, ref, COMPONENT_IFACE, "being given the focus");
  await seam.call({
    destination: ref.busName,
    path: ref.objectPath,
    iface: COMPONENT_IFACE,
    member: "GrabFocus",
  });
}

// BRINGING AN ELEMENT INTO VIEW. The enum stays here; the wire asked only to
// make the element visible and is told only whether it now is.
//
// "Whether it now is" is the comparison, and the element publishes it: a node
// that is visible in the tree but not showing on screen is offscreen
// (roles.ts). That state IS the reveal's entire claim, so it is the one thing
// read back. Nothing here reads a coordinate: where on the screen it landed is
// a promise about one machine, and it is still not made.
export async function scrollIntoView(seam: CallSeam, ref: NativeRef): Promise<void> {
  await requireInterface(seam, ref, COMPONENT_IFACE, "being brought into view");
  await seam.call({
    destination: ref.busName,
    path: ref.objectPath,
    iface: COMPONENT_IFACE,
    member: "ScrollTo",
    signature: "u",
    body: [SCROLL_ANYWHERE],
  });
  const [states] = await seam.call({
    destination: ref.busName,
    path: ref.objectPath,
    iface: ACCESSIBLE_IFACE,
    member: "GetState",
  });
  const [lower, upper] = Array.isArray(states) ? [Number(states[0] ?? 0), Number(states[1] ?? 0)] : [0, 0];
  const after = toNeutralStates(lower, upper);
  if (after.includes("offscreen")) {
    throw observed("bringing this element into view", "offscreen", "on screen");
  }
}

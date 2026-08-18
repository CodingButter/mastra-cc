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
} from "../../backend.js";
import { UnrecordedExchangeError } from "./channel.js";

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
export async function performAction(seam: CallSeam, ref: NativeRef, action: string): Promise<void> {
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
    await seam.call({
      destination: ref.busName,
      path: ref.objectPath,
      iface: ACTION_IFACE,
      member: "DoAction",
      signature: "i",
      body: [index],
    });
    return;
  }

  throw new UnpublishedActionError(
    `this element does not publish an action named ${JSON.stringify(action)} - it publishes ${JSON.stringify(seen)}`,
  );
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
}

async function characterCount(seam: CallSeam, ref: NativeRef): Promise<number> {
  return Number(await propertyOf(seam, ref, TEXT_IFACE, "CharacterCount"));
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
  const length = await characterCount(seam, ref);
  if (offset < 0 || offset > length) {
    throw new TextOffsetOutOfRangeError(
      `offset ${offset} is outside this element's text, which holds ${length} characters - refused rather than moved to the end`,
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
}

// BRINGING AN ELEMENT INTO VIEW. The enum stays here; the wire asked only to
// make the element visible and is told only whether it now is.
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
}

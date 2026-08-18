// Reading the bounds an element publishes for its own magnitude (ADR-0045
// clause 4). Nothing in this file decides what an element's range IS; it asks,
// and carries the numbers through in the element's own units.
//
// The unit question is the whole point. `Component.ScrollTo` takes an enum and
// `Component.ScrollToPoint` takes pixels - two incompatible unit systems for
// "scroll" on ONE platform - so a daemon that invented a unit would be wrong on
// its own machine before it was ever ported. A percentage is a READING of the
// range below, never a unit imposed from above, and an element that publishes
// no range gets no percentage computed for it anywhere.
//
// The same pre-flight discipline as actions.ts, for the same reason: ask which
// interfaces the element carries before asking a question only some elements
// can answer, so capture and replay decide identically.

import type { Operation, Range } from "@mastra-cc/protocol-types";
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

const ACCESSIBLE_IFACE = "org.a11y.atspi.Accessible";
const EDITABLE_TEXT_IFACE = "org.a11y.atspi.EditableText";
const PROPERTIES_IFACE = "org.freedesktop.DBus.Properties";
const TEXT_IFACE = "org.a11y.atspi.Text";
const VALUE_IFACE = "org.a11y.atspi.Value";

export interface PublishedOperations {
  operations: Operation[];
  diagnostic?: Record<string, string>;
}

// dbus-native hands a variant back either unwrapped or as a [signature,
// [value]] pair. Both shapes are observed live on this machine; accept both.
function unwrapVariant(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  const inner = raw[1];
  return Array.isArray(inner) ? inner[0] : inner;
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const named = /org\.[A-Za-z0-9_.]*Error\.[A-Za-z0-9_]+/.exec(message);
  return named ? `${named[0]}: ${message.slice(0, 200)}` : message.slice(0, 200);
}

async function numberProperty(seam: CallSeam, ref: NativeRefLike, name: string): Promise<number> {
  const [raw] = await seam.call({
    destination: ref.busName,
    path: ref.objectPath,
    iface: PROPERTIES_IFACE,
    member: "Get",
    signature: "ss",
    body: [VALUE_IFACE, name],
  });
  return Number(unwrapVariant(raw));
}

interface NativeRefLike {
  busName: string;
  objectPath: string;
}

// The range, exactly as the element reports it. A live `level bar` on this
// machine published MinimumValue=0, MaximumValue=1, CurrentValue=0.985… and
// MinimumIncrement=0; a `yad --scale` slider in the sandboxed session published
// 0 / 100 / 0 / 1. Two different unit systems, both correct, neither one this
// daemon's business to reconcile.
//
// MinimumIncrement is the one number that is NOT carried through blindly. The
// schema says an absent `step` means the element published none, never that
// the step is zero - so a zero increment (the level bar's answer: "I declare no
// meaningful step") is carried as absence, which is what it means. Writing 0
// would state that no change is meaningful, which is a different claim.
async function readRange(seam: CallSeam, ref: NativeRefLike): Promise<Range> {
  const minimum = await numberProperty(seam, ref, "MinimumValue");
  const maximum = await numberProperty(seam, ref, "MaximumValue");
  const current = await numberProperty(seam, ref, "CurrentValue");
  const increment = await numberProperty(seam, ref, "MinimumIncrement");
  const range: Range = { minimum, maximum, current };
  if (Number.isFinite(increment) && increment > 0) range.step = increment;
  return range;
}

// Which interface backs which operation. This is a fact about this platform and
// it stops here: nothing above the seam knows that setting text needs a
// different interface from reading a caret position.
const BACKING_INTERFACE: Record<string, string> = {
  setValue: VALUE_IFACE,
  setText: EDITABLE_TEXT_IFACE,
  setCaret: TEXT_IFACE,
  // Every element on this bus carries Component - the baseline interface
  // histogram read Component on 1,500 of 1,501 elements - but "almost always"
  // is not "always", and the element is asked rather than assumed.
  reveal: "org.a11y.atspi.Component",
};

const OPERATION_ORDER = ["setValue", "setText", "setCaret", "reveal"] as const;

// EVERY operation is reported for EVERY element, per the schema: when a route
// answers this question it answers all of it, so an operation the element does
// not back is present and `not-exposed` rather than missing. An absent entry
// would be a silence, and a silence is indistinguishable from a route that
// never asked.
//
// `not-exposed` here is a fact about the application, never a policy shape.
// Nothing was withheld and no setting turned it off - the element does not
// publish the interface. Saying it in a policy shape would teach a caller that
// some setting could change the answer, which is the false belief ADR-0042
// exists to kill.
export async function readPublishedOperations(seam: CallSeam, ref: NativeRefLike): Promise<PublishedOperations> {
  let interfaces: string[];
  try {
    const [listed] = await seam.call({
      destination: ref.busName,
      path: ref.objectPath,
      iface: ACCESSIBLE_IFACE,
      member: "GetInterfaces",
    });
    interfaces = Array.isArray(listed) ? listed.map(String) : [];
  } catch (error) {
    // An element that cannot say which interfaces it carries answers no
    // operations AND says why - the same shape actions.ts uses, for the same
    // reason: letting the error escape deletes the whole element from the
    // answer at the walk's catch.
    if (error instanceof UnrecordedExchangeError) throw error;
    return { operations: [], diagnostic: { "mastra-cc/operations-unreadable": describeError(error) } };
  }

  const operations: Operation[] = [];
  let rangeUnreadable: string | undefined;

  for (const operation of OPERATION_ORDER) {
    if (!interfaces.includes(BACKING_INTERFACE[operation])) {
      operations.push({ operation, availability: "not-exposed" });
      continue;
    }
    if (operation !== "setValue") {
      operations.push({ operation, availability: "available" });
      continue;
    }
    // Only setValue carries bounds. The others act on content and position,
    // which the element does not publish limits for in this shape.
    try {
      operations.push({ operation, availability: "available", range: await readRange(seam, ref) });
    } catch (error) {
      if (error instanceof UnrecordedExchangeError) throw error;
      // The interface is published and the numbers would not come. The
      // operation stays available - the element says it backs it - and the
      // range is ABSENT, which the schema defines as the element's own silence.
      // Substituting bounds of our own here is exactly what clause 4 forbids.
      rangeUnreadable = describeError(error);
      operations.push({ operation, availability: "available" });
    }
  }

  return rangeUnreadable === undefined
    ? { operations }
    : { operations, diagnostic: { "mastra-cc/range-unreadable": rangeUnreadable } };
}

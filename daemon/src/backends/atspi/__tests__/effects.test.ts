import { describe, expect, it } from "vitest";
import {
  MagnitudeOutOfRangeError,
  OperationNotExposedError,
  TextOffsetOutOfRangeError,
  UnpublishedActionError,
  WriteNotObservedError,
} from "../../../backend.js";
import {
  insertText,
  performAction,
  scrollIntoView,
  setCaretOffset,
  setTextContents,
  setValue,
} from "../effects.js";

// Performing, as distinct from reading. These tests pin the four ways a verb
// can be wrong in a way that still returns success on the real platform:
// performing the wrong action because the bulk list named it, performing an
// action nobody published, writing outside the bounds the element declared, and
// treating a missing interface as a policy refusal.
//
// The instrument is a scripted channel injected at the Channel seam - the same
// seam the replay channel occupies. It invents no tree data and bypasses no
// production path; it drives the real backend logic against chosen replies, for
// shapes no capture target on this machine publishes. Tapes stay recorded.

const REF = { busName: ":1.0", objectPath: "/org/a11y/atspi/accessible/16" };

const ACTION = "org.a11y.atspi.Action";
const COMPONENT = "org.a11y.atspi.Component";
const EDITABLE_TEXT = "org.a11y.atspi.EditableText";
const TEXT = "org.a11y.atspi.Text";
const VALUE = "org.a11y.atspi.Value";

interface Exchange {
  iface: string;
  member: string;
  body?: unknown[];
}

/**
 * Records what was actually asked, which is the point of most of these tests.
 *
 * `changing` scripts a key that answers DIFFERENTLY on successive calls - which
 * is the only way to express the world these tests exist to describe, where a
 * field reads one way before a write and another way after it.
 */
function scriptedChannel(replies: Record<string, unknown[]>, changing: Record<string, unknown[][]> = {}) {
  const asked: Exchange[] = [];
  const queues: Record<string, unknown[][]> = Object.fromEntries(
    Object.entries(changing).map(([key, values]) => [key, [...values]]),
  );
  return {
    asked,
    async call(exchange: Exchange) {
      asked.push({ iface: exchange.iface, member: exchange.member, body: exchange.body });
      const key =
        exchange.member === "GetName" || exchange.member === "DoAction"
          ? `${exchange.member}:${String(exchange.body?.[0])}`
          : exchange.member === "Get"
            ? `Get:${String(exchange.body?.[1])}`
            : exchange.member;
      const queued = queues[key];
      if (queued !== undefined && queued.length > 0) return queued.shift() as unknown[];
      const scripted = replies[key];
      if (scripted === undefined) throw new Error(`test channel: nothing scripted for ${key}`);
      return scripted;
    },
  };
}

describe("performing an action", () => {
  it("performs the index whose own name matches, not the one the bulk list named", async () => {
    // The measured case, inverted into a trap: bulk order says the caller's
    // word is at index 0, per-index names say it is at index 1. A reader that
    // trusts the bulk list performs the wrong verb and reports success.
    const channel = scriptedChannel({
      GetInterfaces: [["org.a11y.atspi.Accessible", ACTION]],
      GetActions: [[["showContextMenu", "", ""], ["doDefault", "", ""]]],
      "GetName:0": ["doDefault"],
      "GetName:1": ["showContextMenu"],
      "DoAction:1": [true],
    });

    await performAction(channel, REF, "showContextMenu");

    const performed = channel.asked.filter((exchange) => exchange.member === "DoAction");
    expect(performed).toHaveLength(1);
    expect(performed[0].body?.[0], "performed the index the bulk list named, not the one that named itself").toBe(1);
  });

  it("names an action whose bulk cell is blank, and performs that index", async () => {
    // 10 of 263 elements measured on this machine answered bulk GetActions
    // with empty name strings while GetName(i) answered the real word. An
    // element in that state must remain fully operable.
    const channel = scriptedChannel({
      GetInterfaces: [["org.a11y.atspi.Accessible", ACTION]],
      GetActions: [[["", "", ""], ["", "", ""]]],
      "GetName:0": ["doDefault"],
      "GetName:1": ["showContextMenu"],
      "DoAction:0": [true],
    });

    await performAction(channel, REF, "doDefault");

    expect(channel.asked.filter((exchange) => exchange.member === "DoAction")[0].body?.[0]).toBe(0);
  });

  it("refuses an action the element does not publish, naming what it does publish", async () => {
    const channel = scriptedChannel({
      GetInterfaces: [["org.a11y.atspi.Accessible", ACTION]],
      GetActions: [[["click", "", ""]]],
      "GetName:0": ["click"],
    });

    // "press" is the deleted table's word and semantically close to "click".
    // Close is not the same: performing the nearest match would be the
    // role-to-action table this milestone deleted, with a search function.
    await expect(performAction(channel, REF, "press")).rejects.toBeInstanceOf(UnpublishedActionError);
    expect(channel.asked.some((exchange) => exchange.member === "DoAction")).toBe(false);
  });

  it("reports an element with no action interface as not-exposed, without asking it to act", async () => {
    const channel = scriptedChannel({ GetInterfaces: [["org.a11y.atspi.Accessible"]] });

    await expect(performAction(channel, REF, "click")).rejects.toBeInstanceOf(OperationNotExposedError);
    expect(channel.asked.map((exchange) => exchange.member)).toEqual(["GetInterfaces"]);
  });
});

describe("setting a magnitude", () => {
  it("writes a value inside the range the element published", async () => {
    const channel = scriptedChannel({
      GetInterfaces: [["org.a11y.atspi.Accessible", VALUE]],
      "Get:MinimumValue": [0],
      "Get:MaximumValue": [1],
      Set: [],
      // The read-back the write is checked against: the element holds what was
      // asked for, so this write is observed rather than merely reported.
      "Get:CurrentValue": [0.5],
    });

    await setValue(channel, REF, 0.5);

    const written = channel.asked.find((exchange) => exchange.member === "Set");
    expect(written?.body?.[1]).toBe("CurrentValue");
  });

  it("refuses a magnitude the platform clamped to somewhere else, rather than reporting the write", async () => {
    // The measured failure the range check above cannot see: the write is in
    // range, the platform accepts it, and the element lands on a step it never
    // published. Without the read-back this answers with a fresh, honest-
    // looking element holding a value nobody asked for.
    const channel = scriptedChannel({
      GetInterfaces: [["org.a11y.atspi.Accessible", VALUE]],
      "Get:MinimumValue": [0],
      "Get:MaximumValue": [100],
      Set: [],
      "Get:CurrentValue": [75],
    });

    await expect(setValue(channel, REF, 73)).rejects.toBeInstanceOf(WriteNotObservedError);
  });

  it("refuses a magnitude outside the published range BEFORE the call", async () => {
    // The platform clamps and reports success. A refusal after the fact would
    // be a report about a value the element never held.
    const channel = scriptedChannel({
      GetInterfaces: [["org.a11y.atspi.Accessible", VALUE]],
      "Get:MinimumValue": [0],
      "Get:MaximumValue": [1],
    });

    await expect(setValue(channel, REF, 60)).rejects.toBeInstanceOf(MagnitudeOutOfRangeError);
    expect(channel.asked.some((exchange) => exchange.member === "Set"), "wrote anyway").toBe(false);
  });

  it("reports an element publishing no value interface as not-exposed, and computes no range of its own", async () => {
    const channel = scriptedChannel({ GetInterfaces: [["org.a11y.atspi.Accessible", COMPONENT]] });

    await expect(setValue(channel, REF, 0.5)).rejects.toBeInstanceOf(OperationNotExposedError);
    // No range was read, so no percentage of anything could have been computed.
    expect(channel.asked.map((exchange) => exchange.member)).toEqual(["GetInterfaces"]);
  });
});

describe("writing text and placing the caret", () => {
  it("refuses an offset beyond the element's own text instead of letting it clamp", async () => {
    // Measured: an insert at offset 99999 into a nine-character field was
    // clamped to the end, performed, and reported success. The bound has to be
    // checked on this side, because the platform will not report the move.
    const channel = scriptedChannel({
      GetInterfaces: [["org.a11y.atspi.Accessible", TEXT, EDITABLE_TEXT]],
      "Get:CharacterCount": [9],
      GetText: ["some word"],
    });

    await expect(insertText(channel, REF, "typed", 99999)).rejects.toBeInstanceOf(TextOffsetOutOfRangeError);
    expect(channel.asked.some((exchange) => exchange.member === "InsertText")).toBe(false);
  });

  it("inserts at an offset the text actually holds", async () => {
    const channel = scriptedChannel(
      {
        GetInterfaces: [["org.a11y.atspi.Accessible", TEXT, EDITABLE_TEXT]],
        "Get:CharacterCount": [9],
        InsertText: [true],
      },
      { GetText: [["some word"], ["some wordtyped"]] },
    );

    await insertText(channel, REF, "typed", 9);

    expect(channel.asked.find((exchange) => exchange.member === "InsertText")?.body?.[0]).toBe(9);
  });

  it("reads the text with the end offset the element published, never the bindings' -1", async () => {
    // `GetText(0, -1)` is a binding convenience: over the wire it answers an
    // empty string, so a reader using it sees every field as empty and a
    // self-verify loop re-types into an already-full field. The end offset must
    // be a number the element published.
    const channel = scriptedChannel({
      GetInterfaces: [["org.a11y.atspi.Accessible", TEXT, EDITABLE_TEXT]],
      "Get:CharacterCount": [9],
      GetText: ["some word"],
      SetTextContents: [true],
    });

    await setTextContents(channel, REF, "some word");

    const read = channel.asked.find((exchange) => exchange.member === "GetText");
    expect(read?.body, "asked the wire for a range the element never published").toEqual([0, 9]);
  });

  it("reports a write the read-back disagrees with, instead of the success the platform returned", async () => {
    // The measured failure, exactly: an insert beyond the field's length was
    // CLAMPED to somewhere else, performed, and reported success. The bounds
    // check refuses that particular call, but nothing stops the platform
    // landing a write elsewhere - so the read-back is what decides.
    const channel = scriptedChannel(
      {
        GetInterfaces: [["org.a11y.atspi.Accessible", TEXT, EDITABLE_TEXT]],
        "Get:CharacterCount": [9],
        SetTextContents: [true],
      },
      // Ninety-nine characters were written; the field reads back the nine it
      // was already holding. The call returned true either way.
      { GetText: [["some word"], ["some word"]] },
    );

    const failure = await setTextContents(channel, REF, "x".repeat(99)).catch((error: unknown) => error);

    expect(failure, "a write that did not land was reported as a success").toBeInstanceOf(WriteNotObservedError);
    expect((failure as Error).message).toContain("some word");
  });

  it("detects an insert that landed at a different offset than the one it was aimed at", async () => {
    // A clamped insert produces the RIGHT characters in the WRONG place, so
    // comparing only for presence would pass. The intent is stated as the whole
    // content the field should hold afterwards.
    const channel = scriptedChannel(
      {
        GetInterfaces: [["org.a11y.atspi.Accessible", TEXT, EDITABLE_TEXT]],
        "Get:CharacterCount": [9],
        InsertText: [true],
      },
      { GetText: [["abcdefghi"], ["abcdefghityped"]] },
    );

    const failure = await insertText(channel, REF, "typed", 4).catch((error: unknown) => error);

    expect(failure, "an insert clamped to the end was accepted as an insert at offset 4").toBeInstanceOf(
      WriteNotObservedError,
    );
    expect((failure as Error).message).toContain("abcdtypedefghi");
  });

  it("places the caret at the end when no offset is given", async () => {
    const channel = scriptedChannel({
      GetInterfaces: [["org.a11y.atspi.Accessible", TEXT]],
      "Get:CharacterCount": [9],
      SetCaretOffset: [true],
      // Where the caret actually landed, read back off the element.
      "Get:CaretOffset": [9],
    });

    await setCaretOffset(channel, REF, undefined);

    expect(channel.asked.find((exchange) => exchange.member === "SetCaretOffset")?.body?.[0]).toBe(9);
  });

  it("refuses a caret the platform placed somewhere other than where it was aimed", async () => {
    // SetCaretOffset answers true for a move it did not make. The offset is in
    // bounds, so the check before the call passes; only reading the caret back
    // can see that it sits somewhere else.
    const channel = scriptedChannel({
      GetInterfaces: [["org.a11y.atspi.Accessible", TEXT]],
      "Get:CharacterCount": [9],
      SetCaretOffset: [true],
      "Get:CaretOffset": [0],
    });

    await expect(setCaretOffset(channel, REF, 4)).rejects.toBeInstanceOf(WriteNotObservedError);
  });

  it("reports a field with no editable-text interface as not-exposed rather than refusing by policy", async () => {
    // not-exposed is a fact about the application. A policy-shaped refusal
    // would tell an agent some setting could change this answer, which is the
    // false belief ADR-0042 exists to kill.
    const channel = scriptedChannel({ GetInterfaces: [["org.a11y.atspi.Accessible", TEXT]] });

    const failure = await insertText(channel, REF, "typed", 0).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OperationNotExposedError);
    // The wording must not leave a reader believing something could be
    // granted, permitted or turned on to change the answer. It may mention a
    // setting only to deny that one is involved, which is what it does.
    expect((failure as Error).message).not.toMatch(/refused|denied|not permitted|unauthoriz|authority/i);
    expect((failure as Error).message).toMatch(/never offered/);
  });
});

describe("revealing an element", () => {
  it("asks the platform to bring it into view without naming a coordinate", async () => {
    const channel = scriptedChannel({
      GetInterfaces: [["org.a11y.atspi.Accessible", COMPONENT]],
      ScrollTo: [true],
      // Visible and showing: bits 30 and 25 both set, which is what "on
      // screen" reads as. This is the reveal's whole claim, read back.
      GetState: [[(1 << 30) | (1 << 25), 0]],
    });

    await scrollIntoView(channel, REF);

    const scrolled = channel.asked.find((exchange) => exchange.member === "ScrollTo");
    expect(scrolled, "reveal must use the enum form, never ScrollToPoint's pixels").toBeDefined();
    expect(channel.asked.some((exchange) => exchange.member === "ScrollToPoint")).toBe(false);
  });

  it("refuses a reveal that left the element off screen instead of reporting it as done", async () => {
    // ScrollTo answers true for a scroll a non-scrolling container never made.
    // Visible in the tree but not showing on screen IS offscreen, and that is
    // the one state this operation claims to have changed.
    const channel = scriptedChannel({
      GetInterfaces: [["org.a11y.atspi.Accessible", COMPONENT]],
      ScrollTo: [true],
      GetState: [[1 << 30, 0]],
    });

    await expect(scrollIntoView(channel, REF)).rejects.toBeInstanceOf(WriteNotObservedError);
  });
});


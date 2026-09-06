import { describe, expect, it } from "vitest";
import type { Channel } from "../backends/atspi/channel.js";
import { AtspiBackend } from "../backends/atspi/index.js";
import { replayChannel } from "../backends/replay/index.js";

// KEYS THAT WENT TO THE OTHER WINDOW OF THE SAME NAME.
//
// Measured 2026-09-05 on this desk: one press of Plasma's "Add Wallpaper
// Image..." opens TWO windows called "Open Image", at the same geometry, and X
// reports both. Only one of them is in front. A caller that aims typing at the
// twin behind sends real keys into the front window's field instead, and the
// element it named reads back exactly as it did before.
//
// Before this, `typeText` answered "performed" there - the keys WERE sent, and
// no more was claimed. The errand above it read that as a filled chooser,
// pressed Open on an empty one, and reported a wallpaper the desk never
// received. Typing is the one raw-input verb with something to compare against:
// text that arrives makes the element's own text longer. When it does not, the
// keys did not arrive HERE, and this verb says so.
//
// The cases are the ways that check could become a new lie of its own:
//
//   - an element whose text cannot be read at all is not accused
//   - an empty string is not a claim about anything
//   - a field that DID take the text is not refused for taking it

function deskWhere(options: { takesTheKeys: boolean; readable?: boolean; text?: string; swallowFirst?: boolean }) {
  const tape = replayChannel("gtk-dialog");
  let buffer = options.text ?? "";
  const channel: Channel = {
    async call(exchange) {
      if (exchange.member === "GenerateKeyboardEvent") {
        const body = exchange.body as unknown[];
        if (options.takesTheKeys && typeof body[1] === "string") {
          const keys = body[1] as string;
          buffer += options.swallowFirst === true ? keys.slice(1) : keys;
        }
        return [];
      }
      if (exchange.member === "GrabFocus") return [true];
      if (options.readable === false) return tape.call(exchange);
      if (exchange.member === "GetInterfaces") return [["org.a11y.atspi.Text", "org.a11y.atspi.Component"]];
      if (exchange.member === "GetText") return [buffer];
      return tape.call(exchange);
    },
    watch: (subscribedTo, sink, anchor) => tape.watch(subscribedTo, sink, anchor),
    close: () => tape.close(),
  };
  return { backend: new AtspiBackend(channel, "all"), read: () => buffer };
}

async function anElement(backend: AtspiBackend): Promise<string> {
  const { elements } = await backend.queryElements({ role: "label" });
  const found = elements[0]?.id;
  expect(found, "the tape stopped answering with an element to aim at").toBeDefined();
  return found as string;
}

describe("typing into one of two windows of the same name", () => {
  it("refuses, and says which window the keys reach, when the named element's text did not grow", async () => {
    const desk = deskWhere({ takesTheKeys: false });
    const id = await anElement(desk.backend);
    await expect(desk.backend.typeText({ id, text: "/config/Downloads/mastra-logo-wordmark.png" })).rejects.toThrow(
      /the text did not arrive here/,
    );
    await expect(desk.backend.typeText({ id, text: "x" })).rejects.toThrow(/front/);
    expect(desk.read(), "no keys should have reached the element that was named").toBe("");
  });

  it("says the count it read, so the caller can tell an empty field from a full one", async () => {
    const desk = deskWhere({ takesTheKeys: false, text: "already here" });
    const id = await anElement(desk.backend);
    await expect(desk.backend.typeText({ id, text: "more" })).rejects.toThrow(
      /publishes 12 character\(s\) where it published 12 before them/,
    );
  });

  it("hands back the typing, with its doubt, when the element took the text", async () => {
    const desk = deskWhere({ takesTheKeys: true });
    const id = await anElement(desk.backend);
    const typed = await desk.backend.typeText({ id, text: "wordmark.png" });
    expect(typed.element).toBeDefined();
    expect(desk.read()).toBe("wordmark.png");
  });

  it("does not accuse an element whose text this daemon cannot read", async () => {
    const desk = deskWhere({ takesTheKeys: false, readable: false });
    const id = await anElement(desk.backend);
    const typed = await desk.backend.typeText({ id, text: "unreadable" });
    expect(typed.element).toBeDefined();
  });

  it("makes no claim for a typing of nothing", async () => {
    const desk = deskWhere({ takesTheKeys: false, text: "unchanged" });
    const id = await anElement(desk.backend);
    const typed = await desk.backend.typeText({ id, text: "" });
    expect(typed.element).toBeDefined();
  });
});

// A COUNT THAT IS SHORT IS THE SAME LIE, ONLY QUIETER. Measured 2026-09-05 in
// Dolphin's location field: seventeen characters were sent into a field that
// had just taken the focus and sixteen arrived - the leading key was eaten
// while the widget settled. The field HAD grown, so the zero-growth guard said
// nothing, and the errand navigated to a path that did not exist.
describe("a field that took only some of the keys", () => {
  it("refuses, names how many arrived, and says to clear before typing again", async () => {
    const stage = deskWhere({ takesTheKeys: true, swallowFirst: true });
    const id = await anElement(stage.backend);
    await expect(stage.backend.typeText({ id, text: "/config/Downloads" })).rejects.toThrow(
      /17 character\(s\) were sent and this element grew by 16 - some of the keys did not arrive/,
    );
    await expect(stage.backend.typeText({ id, text: "/config" })).rejects.toThrow(/clearElementText/);
  });

  it("says nothing about a field that took every key", async () => {
    const stage = deskWhere({ takesTheKeys: true });
    const id = await anElement(stage.backend);
    const typed = await stage.backend.typeText({ id, text: "/config/Downloads" });
    expect(typed.element).toBeDefined();
  });
});

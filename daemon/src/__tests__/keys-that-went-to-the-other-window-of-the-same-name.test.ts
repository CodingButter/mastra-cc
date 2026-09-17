import { describe, expect, it } from "vitest";
import type { Channel } from "../backends/atspi/channel.js";
import { AtspiBackend } from "../backends/atspi/index.js";
import { replayChannel } from "../backends/replay/index.js";

function deskWhere(options: { text?: string; result?: string; readable?: boolean }) {
  const tape = replayChannel("gtk-dialog");
  let buffer = options.text ?? "";
  let emissions = 0;
  const channel: Channel = {
    async call(exchange) {
      if (exchange.member === "GenerateKeyboardEvent") {
        emissions += 1;
        buffer = options.result ?? buffer;
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
  return { backend: new AtspiBackend(channel, "all"), read: () => buffer, emissions: () => emissions };
}

describe("typing reports attempted delivery, not length-based certainty", () => {
  it.each([
    ["ASCII", "", "hello", "hello"],
    ["emoji", "", "🙂", "🙂"],
    ["supplementary", "", "𐐀", "𐐀"],
    ["combining sequence", "", "e\u0301", "e\u0301"],
    ["mixed scripts", "", "café — 東京 🙂", "café — 東京 🙂"],
    ["selected replacement", "old", "new", "new"],
    ["middle insertion", "ab", "X", "aXb"],
    ["truncation", "", "hello", "ello"],
    ["equal-length wrong text", "ab", "123", "abXYZ"],
    ["unchanged or delayed publication", "old", "new", "old"],
    ["autocomplete", "", "abc", "abcdef"],
    ["no arrival", "", "hello", ""],
  ])("keeps %s unverified and never re-emits", async (_case, before, text, after) => {
    const desk = deskWhere({ text: before, result: after });
    try {
      const { elements } = await desk.backend.queryElements({ role: "label" });
      const typed = await desk.backend.typeText({ id: elements[0]!.id, text });
      expect(typed.element?.diagnostic).toHaveProperty("mastra-cc/typing-unverified");
      expect(JSON.stringify(typed.element?.diagnostic)).toContain("Observe before deciding whether to retry");
      expect(desk.read()).toBe(after);
      expect(desk.emissions()).toBe(1);
    } finally { await desk.backend.close(); }
  });

  it("does not infer delivery from unavailable content", async () => {
    const desk = deskWhere({ readable: false });
    try {
      const { elements } = await desk.backend.queryElements({ role: "label" });
      const typed = await desk.backend.typeText({ id: elements[0]!.id, text: "unreadable" });
      expect(typed.element?.diagnostic).toHaveProperty("mastra-cc/typing-unverified");
      expect(desk.emissions()).toBe(1);
    } finally { await desk.backend.close(); }
  });
});

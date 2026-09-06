import { describe, expect, it } from "vitest";
import type { Channel } from "../backends/atspi/channel.js";
import { AtspiBackend } from "../backends/atspi/index.js";
import { replayChannel } from "../backends/replay/index.js";
import type { SemanticElement } from "@mastra-cc/protocol-types";

// A KEY SENT WHILE ANOTHER APPLICATION HOLDS THE KEYBOARD (ADR-0086).
//
// Measured 2026-09-05 on this desk: the errand aimed typing at a Konsole field
// while Chromium was the front window. The keys went to Chromium. The daemon
// answered "performed", because raw input is not addressed to an element - it
// goes wherever the display server is pointing the keyboard, and this daemon
// does not raise windows.
//
// The focus read has been measured lying INSIDE an application (it names an
// unrelated node while the key lands perfectly), which is why it may only cast
// doubt there. ACROSS applications it does not lie: the focus walk only reports
// an element under an ancestor the bus marks active, so a focused element in
// another application means the keyboard is in another application's window.
// That reading is good enough to refuse on, and the refusal has to come BEFORE
// the send, because the send is the damage - a wallpaper path typed into a
// browser's search box cannot be taken back.
//
// The cases are the ways this guard could become a lie of its own:
//
//   - a desk where nothing at all holds the keyboard does not refuse
//   - the focus read failing does not refuse (it never could refuse before)
//   - focus elsewhere in the SAME application does not refuse
//   - when it does refuse, NOT ONE KEY is sent

function desk(options: {
  focused?: SemanticElement | null;
  ofElement?: (id: string) => string | undefined;
  raised?: boolean;
}) {
  const tape = replayChannel("gtk-dialog");
  const sent: string[] = [];
  let buffer = "";
  const channel: Channel = {
    async call(exchange) {
      if (exchange.member === "GenerateKeyboardEvent") {
        const body = exchange.body as unknown[];
        sent.push(String(body[1] ?? body[0]));
        if (typeof body[1] === "string") buffer += body[1] as string;
        return [];
      }
      if (exchange.member === "GrabFocus") return [true];
      if (exchange.member === "GetInterfaces") return [["org.a11y.atspi.Text", "org.a11y.atspi.Component"]];
      if (exchange.member === "GetText") return [buffer];
      return tape.call(exchange);
    },
    watch: (subscribedTo, sink, anchor) => tape.watch(subscribedTo, sink, anchor),
    close: () => tape.close(),
  };
  class Desk extends AtspiBackend {
    override async focusedElement(): Promise<SemanticElement | undefined> {
      if (options.focused === null) throw new Error("this desk cannot be read for focus");
      return options.focused;
    }
    protected override async underActiveWindow(): Promise<boolean> {
      return options.raised === true;
    }
    override applicationOfElement(id: string): string | undefined {
      return options.ofElement === undefined ? super.applicationOfElement(id) : options.ofElement(id);
    }
  }
  return { backend: new Desk(channel, "all"), sent };
}

const ELSEWHERE: SemanticElement = { id: "el-in-the-browser", role: "textbox", name: "Search", actions: [], states: [], content: { kind: "text", value: "" } };

async function anElement(backend: AtspiBackend): Promise<string> {
  const { elements } = await backend.queryElements({ role: "label" });
  const found = elements[0]?.id;
  expect(found, "the tape stopped answering with an element to aim at").toBeDefined();
  return found as string;
}

describe("a key sent while another application holds the keyboard", () => {
  it("refuses, names the application that would have received it, and sends nothing", async () => {
    const stage = desk({
      focused: ELSEWHERE,
      ofElement: (id) => (id === ELSEWHERE.id ? "Chromium" : "System Settings"),
    });
    const id = await anElement(stage.backend);
    await expect(stage.backend.typeText({ id, text: "/config/Downloads/mastra-logo-wordmark.png" })).rejects.toThrow(
      /"Chromium"/,
    );
    expect(stage.sent, "the refusal is worth nothing if the keys went out anyway").toEqual([]);
  });

  it("points the caller at the press that would put the keyboard where they aimed", async () => {
    const stage = desk({
      focused: ELSEWHERE,
      ofElement: (id) => (id === ELSEWHERE.id ? "Chromium" : "System Settings"),
    });
    const id = await anElement(stage.backend);
    await expect(stage.backend.sendKeyChord({ id, chord: "Enter" })).rejects.toThrow(/task bar/);
    expect(stage.sent).toEqual([]);
  });

  it("does not refuse when the focus sits elsewhere inside the SAME application", async () => {
    // The reading that has been measured wrong. It may cast doubt; it may not
    // stop a key that has been observed arriving.
    const stage = desk({ focused: ELSEWHERE, ofElement: () => "System Settings" });
    const id = await anElement(stage.backend);
    const typed = await stage.backend.typeText({ id, text: "x" });
    expect(typed.element).toBeDefined();
  });

  it("does not refuse on a desk where nothing claims the keyboard", async () => {
    const stage = desk({ focused: undefined });
    const id = await anElement(stage.backend);
    const typed = await stage.backend.typeText({ id, text: "x" });
    expect(typed.element).toBeDefined();
  });

  it("does not refuse when the desk could not be read for focus at all", async () => {
    const stage = desk({ focused: null });
    const id = await anElement(stage.backend);
    const typed = await stage.backend.typeText({ id, text: "x" });
    expect(typed.element).toBeDefined();
  });
});

// The guard's own way of becoming a lie: the focus walk answers with the FIRST
// focused element in registry order, and two applications can carry a stale
// activation claim at once. Measured 2026-09-05 - a raised settings dialog was
// told the keyboard belonged to a Chromium behind it, every time, and the
// errand died on a refusal that was wrong. A window above the target that
// claims the keyboard is the witness that settles it.
describe("an element whose own window is the front one", () => {
  it("takes the text even while the focus walk names another application", async () => {
    const stage = desk({
      raised: true,
      focused: ELSEWHERE,
      ofElement: (id) => (id === ELSEWHERE.id ? "Chromium" : "System Settings"),
    });
    const target = await anElement(stage.backend);
    const answer = await stage.backend.typeText({ id: target, text: "/config/Downloads/logo.png" });
    expect(answer).toBeDefined();
    expect(stage.sent.length).toBeGreaterThan(0);
  });
});

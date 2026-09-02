import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Channel } from "../backends/atspi/channel.js";
import { AtspiBackend } from "../backends/atspi/index.js";
import { replayChannel } from "../backends/replay/index.js";
import { EffectUnsupportedError, type Backend } from "../backend.js";
import { OwnershipTable } from "../launch/table.js";
import { handleRequest, TYPE_TEXT_MAX_LENGTH, type LaunchContext } from "../server.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// TYPE BLIND, READ BACK (ADR-0070).
//
// ADR-0067 refused a free-form key string. ADR-0070 admits one - measured
// against a browser's address bar that publishes a value to read and no
// interface to set it - and every case here is a way the admission could widen
// into the surface that was refused:
//
//   - type for a session that was never given the class
//   - type on a machine with no route, and blame a setting for it
//   - type a newline, a tab, an escape - a chord in a string's clothes
//   - type a document where a field entry was meant
//   - reach the keyboard from a setElementValue that was just refused
//
// The last one is the one that matters most and, as with the chord, it is the
// ABSENCE of an edge: asserted once against behaviour (a refused set never
// types) and once against the source (nothing calls the handler but dispatch).

const here = dirname(fileURLToPath(import.meta.url));

const A_ROUTE = { route: "test-route" };

interface Typed {
  readonly id: string;
  readonly text: string;
}

function backendThat(options: { typed: Typed[]; focus?: (readonly { name: string; id: string }[] | undefined)[]; refuseFocus?: boolean }): Backend {
  const focusReads = [...(options.focus ?? [])];
  return {
    name: "typing-fixture",
    ...observeOnlyEffects,
    focusedElement: async () => focusReads.shift()?.[0],
    restoreFocus: async (id: string) =>
      options.refuseFocus === true ? { id: "somebody else", role: "textbox", name: "elsewhere", actions: [] } : { id, role: "textbox", name: "back", actions: [] },
    typeText: async (params: { id: string; text: string }) => {
      options.typed.push({ id: params.id, text: params.text });
      return { element: { id: params.id, role: "textbox", name: "Address and search bar", value: params.text, actions: [] } };
    },
    // The field that started all this: it answers the way a browser's omnibox
    // does, with the interface not exposed.
    setElementValue: async () => {
      throw new EffectUnsupportedError("this element publishes no editable-value interface");
    },
    queryElements: async () => ({ elements: [] }),
    applicationOfElement: () => "chromium",
    close: () => undefined,
  } as unknown as Backend;
}

async function call(method: string, params: Record<string, unknown>, launch: Partial<LaunchContext>, backend: Backend) {
  return handleRequest({ type: "request", id: 1, method, params }, backend, {
    permits: new Set(),
    catalog: DEFANGED_CATALOG,
    table: new OwnershipTable(),
    visibility: "all",
    keys: A_ROUTE,
    ...launch,
  } as LaunchContext);
}

const type = (text: string, launch: Partial<LaunchContext>, backend: Backend) => call("typeText", { id: "el-1", text }, launch, backend);

function refusalIn(answer: { refusal?: string; result?: unknown }): string {
  return answer.refusal ?? (answer.result as { refusal?: string } | undefined)?.refusal ?? "";
}

const ARMED = { allows: new Set(["rawInput"]) };

describe("text, typed blind at one element", () => {
  it("refuses a session that was never given the class, without touching the desk", async () => {
    const typed: Typed[] = [];
    const answer = await type("example.com", { allows: new Set() }, backendThat({ typed }));
    expect(refusalIn(answer)).toContain('"typeText" is rawInput-class');
    expect(refusalIn(answer)).toContain("--allow rawInput");
    expect(typed).toEqual([]);
  });

  it("refuses on a machine with no key route, and names no setting for it", async () => {
    const typed: Typed[] = [];
    const answer = await type("example.com", { ...ARMED, keys: undefined }, backendThat({ typed }));
    expect(refusalIn(answer)).toContain('"typeText" cannot be performed');
    expect(refusalIn(answer)).toContain("no setting on this daemon would change that");
    expect(typed).toEqual([]);
  });

  it("refuses a newline by name, and names the chord that replaces it", async () => {
    // The one a caller reaching for typeText to "submit" will have meant. A
    // string that could carry Enter is a chord vocabulary with no list.
    const typed: Typed[] = [];
    for (const text of ["example.com\n", "example.com\r", "\r\n"]) {
      const answer = await type(text, ARMED, backendThat({ typed }));
      expect(refusalIn(answer), JSON.stringify(text)).toContain("a newline");
      expect(refusalIn(answer), JSON.stringify(text)).toContain("Enter");
      expect(refusalIn(answer), JSON.stringify(text)).toContain("sendKeyChord");
    }
    expect(typed).toEqual([]);
  });

  it("refuses a tab, an escape and any other control character, each by name and position", async () => {
    const typed: Typed[] = [];
    const tab = await type("a\tb", ARMED, backendThat({ typed }));
    expect(refusalIn(tab)).toContain("a tab");
    expect(refusalIn(tab)).toContain("position 1");
    const escape = await type("\u001b", ARMED, backendThat({ typed }));
    expect(refusalIn(escape)).toContain("an escape");
    const bell = await type("ab\u0007", ARMED, backendThat({ typed }));
    expect(refusalIn(bell)).toContain("U+0007");
    expect(refusalIn(bell)).toContain("position 2");
    const del = await type("\u007f", ARMED, backendThat({ typed }));
    expect(refusalIn(del)).toContain("U+007F");
    // C1 is a control too - a next-line or a string terminator has no glyph,
    // and "printable only" would be a lie if it stopped at ASCII.
    const c1 = await type("x\u0085y", ARMED, backendThat({ typed }));
    expect(refusalIn(c1)).toContain("U+0085");
    expect(refusalIn(c1)).toContain("position 1");
    const c1end = await type("\u009f", ARMED, backendThat({ typed }));
    expect(refusalIn(c1end)).toContain("U+009F");
    const above = await type("\u00a0\u00a1", ARMED, backendThat({ typed }));
    expect(refusalIn(above)).toBe("");
    expect(typed).toEqual([{ id: "el-1", text: "\u00a0\u00a1" }]);
  });

  it("refuses a text longer than the bound, naming the length and the limit, and takes one exactly at it", async () => {
    const typed: Typed[] = [];
    const over = await type("x".repeat(TYPE_TEXT_MAX_LENGTH + 1), ARMED, backendThat({ typed }));
    expect(refusalIn(over)).toContain(`${TYPE_TEXT_MAX_LENGTH + 1} characters`);
    expect(refusalIn(over)).toContain(`at most ${TYPE_TEXT_MAX_LENGTH}`);
    expect(typed).toEqual([]);
    const at = await type("x".repeat(TYPE_TEXT_MAX_LENGTH), ARMED, backendThat({ typed }));
    expect(refusalIn(at)).toBe("");
    expect(typed).toHaveLength(1);
  });

  it("refuses an empty text rather than performing nothing", async () => {
    const typed: Typed[] = [];
    const answer = await type("", ARMED, backendThat({ typed }));
    expect(refusalIn(answer)).toContain("no text");
    expect(typed).toEqual([]);
  });

  it("delivers the text it was asked for, to the element it was addressed to, and reads it back", async () => {
    const typed: Typed[] = [];
    const answer = await type("example.com", ARMED, backendThat({ typed }));
    expect(refusalIn(answer)).toBe("");
    expect(typed).toEqual([{ id: "el-1", text: "example.com" }]);
    // The element as it reads AFTERWARDS - the caller's evidence, and the
    // only evidence there is (ADR-0067 clause 5, ADR-0070 clause 4).
    const element = (answer.result as { element?: { name?: string; value?: string } }).element;
    expect(element?.name).toBe("Address and search bar");
    expect(element?.value).toBe("example.com");
  });

  it("takes printable text of any script - the bound is on control characters, not on ASCII", async () => {
    const typed: Typed[] = [];
    const answer = await type("café — 東京 🙂", ARMED, backendThat({ typed }));
    expect(refusalIn(answer)).toBe("");
    expect(typed).toEqual([{ id: "el-1", text: "café — 東京 🙂" }]);
  });

  it("says so when the focus it borrowed did not come back", async () => {
    const typed: Typed[] = [];
    const backend = backendThat({
      typed,
      focus: [[{ name: "the document", id: "other" }], [{ name: "the target", id: "el-1" }]],
      refuseFocus: true,
    });
    const answer = await type("example.com", ARMED, backend);
    const note = (answer.result as { element?: { diagnostic?: Record<string, string> } }).element?.diagnostic?.["mastra-cc/focus-preservation"];
    expect(note ?? "").toContain("typing");
    expect(note ?? "").toContain("the document");
  });

  it("a refused setElementValue does not type - the daemon never falls back to the keyboard", async () => {
    // THE PIN. The field answered not-exposed; the caller decides what to do
    // with that. An armed session makes the temptation real: the daemon
    // HOLDS the authority to type here, and still must not.
    const typed: Typed[] = [];
    const answer = await call("setElementValue", { id: "el-1", value: "example.com" }, { ...ARMED, allows: new Set(["rawInput", "edit"]) }, backendThat({ typed }));
    expect(refusalIn(answer)).not.toBe("");
    expect(typed, "a refused set reached the keyboard").toEqual([]);
  });

  it("has no edge from a semantic verb into the typing route", () => {
    // The same assertion as the chord's, against the source: the only edges
    // into the daemon's typing handler are its declaration and the dispatch
    // entry. `backend.typeText(` is excluded by the lookbehind.
    const source = readFileSync(join(here, "..", "server.ts"), "utf8");
    const callers = [...source.matchAll(/(?<![\w.])typeText\(/g)];
    expect(callers).toHaveLength(2);
    expect(source).toContain('typeText: { effectClass: "rawInput", enforcement: "before-call"');
  });

  it("has no edge from the field's own operations into the keyboard, anywhere in the seam", () => {
    // And the same against the seam: setElementValue and setElementText in the
    // accessibility backend must not reach emitString. Counted, not read.
    const source = readFileSync(join(here, "..", "backends", "atspi", "index.ts"), "utf8");
    const emitters = [...source.matchAll(/emitString\(/g)];
    expect(emitters).toHaveLength(1);
    const line = source.slice(0, emitters[0]!.index).split("\n").length;
    const enclosing = source.split("\n").slice(0, line).reverse().find((text) => /^\s+async (\w+)\(/.test(text)) ?? "";
    expect(enclosing).toContain("typeText(");
  });
});

describe("text this daemon could not aim", () => {
  it("types it anyway, as one STRING emission, and says in the debugging subtree that the aim was unconfirmed", async () => {
    const tape = replayChannel("gtk-dialog");
    const generated: unknown[][] = [];
    const wandering: Channel = {
      async call(exchange) {
        if (exchange.member === "GenerateKeyboardEvent") {
          generated.push(exchange.body ?? []);
          return [];
        }
        if (exchange.member === "GrabFocus") return [false];
        return tape.call(exchange);
      },
      watch: (subscribedTo, sink, anchor) => tape.watch(subscribedTo, sink, anchor),
      close: () => tape.close(),
    };

    const backend = new AtspiBackend(wandering, new Set(["yad"]));
    const seen = await backend.queryElements({});
    const target = seen.elements.find((element) => element.role === "button");
    expect(target).toBeDefined();

    const result = await backend.typeText({ id: target!.id, text: "example.com" });

    // One emission carrying the whole text with the STRING synth (4), never
    // one keysym per character: the measured route, not the imagined one.
    expect(generated).toEqual([[0, "example.com", 4]]);
    expect(result.element).toBeDefined();
    const note = (result.element?.diagnostic as Record<string, string> | undefined)?.["mastra-cc/key-aim"];
    expect(note, "text typed into an unconfirmed aim said nothing about it").toBeDefined();
    expect(note).toContain("not confirmed to hold the focus");
    await backend.close();
  });
});

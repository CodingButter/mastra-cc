import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Channel } from "../backends/atspi/channel.js";
import { AtspiBackend } from "../backends/atspi/index.js";
import { replayChannel } from "../backends/replay/index.js";
import type { Backend } from "../backend.js";
import { OwnershipTable } from "../launch/table.js";
import { handleRequest, type LaunchContext } from "../server.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// CLEARING IS COUNTED, AND THEN CHECKED (ADR-0076).
//
// Typing is an append. A field that publishes a value to read and no interface
// to set it can be typed into and never replaced, and this contract has no
// held-modifier chord to select with, so the only way to empty one is to press
// a key once per character. Every case here is a way that could become a lie:
//
//   - clear for a session that was never given the class
//   - clear on a machine with no route, and blame a setting for it
//   - clear an element whose text this daemon cannot read - an unbounded run
//     of destructive keys aimed at a window it cannot check afterwards
//   - clear a document, one keystroke at a time, because nothing counted it
//   - press the keys, read back text that is still there, and answer success
//
// The last one is why this verb refuses instead of returning: unlike the other
// two raw-input methods, this one HAS an intended state to compare against.

const here = dirname(fileURLToPath(import.meta.url));

const BACKSPACE = 0xff08;
const END = 0xff57;

const A_ROUTE = { route: "test-route" };
const ARMED = { allows: new Set(["rawInput"]) };

// A desk whose elements all publish text, over the recorded one that does not.
// `deletes` says whether a Backspace actually removes a character: a field that
// ignores the key is the shape of a keystroke landing in another window, and
// this daemon must not call that empty.
function deskCarrying(text: string, options: { deletes?: boolean; readable?: boolean } = {}) {
  const tape = replayChannel("gtk-dialog");
  const pressed: number[] = [];
  let buffer = text;
  const channel: Channel = {
    async call(exchange) {
      if (exchange.member === "GenerateKeyboardEvent") {
        const keysym = Number((exchange.body as unknown[])[0]);
        pressed.push(keysym);
        if (keysym === BACKSPACE && options.deletes !== false) {
          // Delete a CHARACTER, the way a field does - not a UTF-16 unit,
          // which would leave half an emoji behind and make the count below
          // meaningless.
          buffer = [...buffer].slice(0, -1).join("");
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
  return { backend: new AtspiBackend(channel, "all"), pressed, read: () => buffer };
}

async function anElement(backend: AtspiBackend): Promise<string> {
  const { elements } = await backend.queryElements({ role: "label" });
  const found = elements[0]?.id;
  expect(found, "the tape stopped answering with an element to aim at").toBeDefined();
  return found as string;
}

function backendThat(options: { cleared: string[]; answer?: () => Promise<unknown> }): Backend {
  return {
    name: "clearing-fixture",
    ...observeOnlyEffects,
    focusedElement: async () => undefined,
    restoreFocus: async (id: string) => ({ id, role: "textbox", name: "back", actions: [] }),
    clearElementText: async (params: { id: string }) => {
      options.cleared.push(params.id);
      return { element: { id: params.id, role: "textbox", name: "Address and search bar", actions: [] } };
    },
    queryElements: async () => ({ elements: [] }),
    applicationOfElement: () => "chromium",
    close: () => undefined,
  } as unknown as Backend;
}

async function clear(id: string, launch: Partial<LaunchContext>, backend: Backend) {
  return handleRequest({ type: "request", id: 1, method: "clearElementText", params: { id } }, backend, {
    permits: new Set(),
    catalog: DEFANGED_CATALOG,
    table: new OwnershipTable(),
    visibility: "all",
    keys: A_ROUTE,
    ...launch,
  } as LaunchContext);
}

function refusalIn(answer: { refusal?: string; result?: unknown }): string {
  return answer.refusal ?? (answer.result as { refusal?: string } | undefined)?.refusal ?? "";
}

describe("emptying a field one key at a time", () => {
  it("presses once per character, ends first, and reads the element back empty", async () => {
    const desk = deskCarrying("example.com");
    const id = await anElement(desk.backend);
    const answer = await desk.backend.clearElementText({ id });
    // End, then one Backspace for each of the eleven characters. The count is
    // the element's own reading, not a guess at how long a field might be.
    expect(desk.pressed[0]).toBe(END);
    expect(desk.pressed.filter((key) => key === BACKSPACE)).toHaveLength("example.com".length);
    expect(desk.pressed).toHaveLength("example.com".length + 1);
    expect(desk.read()).toBe("");
    expect(answer.element?.content).toEqual({ kind: "text", value: "" });
  });

  it("counts characters and not code units, so an emoji is one press", async () => {
    // A surrogate pair is one character to the person deleting it. Counting
    // UTF-16 units would press twice and eat the character before it.
    const desk = deskCarrying("a😀b");
    const id = await anElement(desk.backend);
    await desk.backend.clearElementText({ id });
    expect(desk.pressed.filter((key) => key === BACKSPACE)).toHaveLength(3);
  });

  it("presses nothing at all for a field that is already empty", async () => {
    const desk = deskCarrying("");
    const id = await anElement(desk.backend);
    const answer = await desk.backend.clearElementText({ id });
    expect(desk.pressed).toEqual([]);
    expect(answer.element?.content).toEqual({ kind: "text", value: "" });
  });

  it("refuses an element whose text it cannot read, rather than clearing blind", async () => {
    // The recorded desk's own labels publish no readable text. Pressing here
    // would be an unknown number of destructive keys at a window this daemon
    // has no way to check afterwards.
    const desk = deskCarrying("ignored", { readable: false });
    const id = await anElement(desk.backend);
    await expect(desk.backend.clearElementText({ id })).rejects.toThrow(/does not publish text this daemon can read/);
    expect(desk.pressed).toEqual([]);
  });

  it("refuses a text longer than it will press through, by length, without pressing", async () => {
    const desk = deskCarrying("x".repeat(1025));
    const id = await anElement(desk.backend);
    await expect(desk.backend.clearElementText({ id })).rejects.toThrow(/1025 characters/);
    expect(desk.pressed).toEqual([]);
  });

  it("refuses when the element did not come back empty, and says how much is left", async () => {
    // The keystroke that landed in another window. Eleven Backspaces were sent
    // and the field still reads what it read before; a success here would be
    // the daemon reporting an emptiness nobody observed.
    const desk = deskCarrying("example.com", { deletes: false });
    const id = await anElement(desk.backend);
    await expect(desk.backend.clearElementText({ id })).rejects.toThrow(/11 characters still in it/);
    expect(desk.pressed.filter((key) => key === BACKSPACE)).toHaveLength(11);
  });

  it("refuses an id it never answered, in the words it uses for one that was never real", async () => {
    const desk = deskCarrying("example.com");
    await expect(desk.backend.clearElementText({ id: "el-000000000000" })).rejects.toThrow(/was ever answered/);
    expect(desk.pressed).toEqual([]);
  });
});

describe("the gates in front of clearing", () => {
  it("refuses a session that was never given the class, without touching the desk", async () => {
    const cleared: string[] = [];
    const answer = await clear("el-1", { allows: new Set() }, backendThat({ cleared }));
    expect(refusalIn(answer)).toContain('"clearElementText" is rawInput-class');
    expect(refusalIn(answer)).toContain("--allow rawInput");
    expect(cleared).toEqual([]);
  });

  it("refuses on a machine with no key route, and names no setting for it", async () => {
    const cleared: string[] = [];
    const answer = await clear("el-1", { ...ARMED, keys: undefined }, backendThat({ cleared }));
    expect(refusalIn(answer)).toContain('"clearElementText" cannot be performed');
    expect(refusalIn(answer)).toContain("no setting on this daemon would change that");
    expect(cleared).toEqual([]);
  });

  it("clears the element it was addressed to, and answers with the element as it reads after", async () => {
    const cleared: string[] = [];
    const answer = await clear("el-1", ARMED, backendThat({ cleared }));
    expect(refusalIn(answer)).toBe("");
    expect(cleared).toEqual(["el-1"]);
    expect((answer.result as { element?: { name?: string } }).element?.name).toBe("Address and search bar");
  });

  it("has no edge from a semantic verb into the clearing route", async () => {
    // ADR-0046 clause 3, the same assertion the other two raw-input methods
    // carry: a setElementText that was refused must not come back as a field
    // emptied by keystroke. Two matches - the declaration and the dispatch
    // entry - because `backend.clearElementText(` is excluded by the lookbehind.
    const source = readFileSync(join(here, "..", "server.ts"), "utf8");
    expect([...source.matchAll(/(?<![\w.])clearElementText\(/g)]).toHaveLength(2);
    expect(source).toContain('clearElementText: { effectClass: "rawInput", enforcement: "before-call"');
  });
});

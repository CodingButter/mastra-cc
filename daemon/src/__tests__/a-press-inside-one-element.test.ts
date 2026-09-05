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

// A PRESS INSIDE ONE ELEMENT (ADR-0078).
//
// The pointer was the thing this contract would not build for a year, and the
// reason was sound: a method that takes a screen coordinate clicks a PLACE, and
// a daemon that clicks places cannot say afterwards what it clicked. What broke
// the deadlock was a wallpaper grid whose items publish no action at all - seen,
// named, bounded, and untouchable - so the road that was meant to be the only
// one was simply a road that ended.
//
// This method is the concession, and every case below is a way the concession
// could rot into the thing it replaced:
//
//   - a press for a session that was never given the class
//   - a press on a machine with no route, blamed on a setting
//   - a coordinate that came from the CALLER rather than from the element
//   - a fraction outside the element, clamped into a press on its neighbour
//   - a press at an element with no rectangle, or an empty one, or one that
//     sits off the screen, aimed at a default place that does not exist
//   - a button or a count this contract never defined, mapped to a near one

const here = dirname(fileURLToPath(import.meta.url));

const A_ROUTE = { route: "test-route" };
const ARMED = { allows: new Set(["rawInput"]) };

interface Press {
  x: number;
  y: number;
  gesture: string;
}

// A desk whose elements sit at a known rectangle. `extents` is what the
// platform publishes for every element here; `undefined` is the element that
// carries no Component interface at all, which is the shape of a thing with no
// place on the screen.
function deskAt(extents: [number, number, number, number] | undefined) {
  const tape = replayChannel("gtk-dialog");
  const presses: Press[] = [];
  const channel: Channel = {
    async call(exchange) {
      if (exchange.member === "GenerateMouseEvent") {
        const body = exchange.body as unknown[];
        presses.push({ x: Number(body[0]), y: Number(body[1]), gesture: String(body[2]) });
        return [];
      }
      if (exchange.member === "GetExtents") {
        if (extents === undefined) throw new Error("this element carries no Component interface");
        return [extents];
      }
      return tape.call(exchange);
    },
    watch: (subscribedTo, sink, anchor) => tape.watch(subscribedTo, sink, anchor),
    close: () => tape.close(),
  };
  return { backend: new AtspiBackend(channel, "all"), presses };
}

async function anElement(backend: AtspiBackend): Promise<string> {
  const { elements } = await backend.queryElements({ role: "label" });
  const found = elements[0]?.id;
  expect(found, "the tape stopped answering with an element to aim at").toBeDefined();
  return found as string;
}

function backendThat(options: { clicked: unknown[] }): Backend {
  return {
    name: "pointer-fixture",
    ...observeOnlyEffects,
    focusedElement: async () => undefined,
    restoreFocus: async (id: string) => ({ id, role: "button", name: "back", actions: [] }),
    clickElement: async (params: unknown) => {
      options.clicked.push(params);
      return { element: { id: "el-1", role: "listitem", name: "Mastra logo", actions: [] } };
    },
    queryElements: async () => ({ elements: [] }),
    applicationOfElement: () => "systemsettings",
    close: () => undefined,
  } as unknown as Backend;
}

async function click(params: Record<string, unknown>, launch: Partial<LaunchContext>, backend: Backend) {
  return handleRequest({ type: "request", id: 1, method: "clickElement", params }, backend, {
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

describe("aiming a press from an element's own rectangle", () => {
  it("presses the centre of the rectangle the platform publishes right now", async () => {
    const desk = deskAt([100, 200, 80, 40]);
    const id = await anElement(desk.backend);
    await desk.backend.clickElement({ id });
    // The coordinate is arithmetic on bounds read a moment ago, not a number
    // that crossed the wire: 100 + 80/2, 200 + 40/2.
    expect(desk.presses).toEqual([{ x: 140, y: 220, gesture: "b1c" }]);
  });

  it("presses where inside the element it was asked to, as a fraction of that element", async () => {
    const desk = deskAt([100, 200, 80, 40]);
    const id = await anElement(desk.backend);
    await desk.backend.clickElement({ id, x: 0, y: 1 });
    expect(desk.presses).toEqual([{ x: 100, y: 240, gesture: "b1c" }]);
  });

  it("asks the platform for the double gesture rather than sending two presses", async () => {
    const desk = deskAt([0, 0, 10, 10]);
    const id = await anElement(desk.backend);
    await desk.backend.clickElement({ id, count: 2 });
    expect(desk.presses).toEqual([{ x: 5, y: 5, gesture: "b1d" }]);
  });

  it("presses the button it was named, and not the one nearest to it", async () => {
    const desk = deskAt([0, 0, 10, 10]);
    const id = await anElement(desk.backend);
    await desk.backend.clickElement({ id, button: "right" });
    expect(desk.presses[0]?.gesture).toBe("b3c");
    await expect(desk.backend.clickElement({ id, button: "thumb" })).rejects.toThrow(/no pointer button named/);
    expect(desk.presses).toHaveLength(1);
  });

  it("refuses an element the platform gives no rectangle for, rather than pressing at a default", async () => {
    const desk = deskAt(undefined);
    const id = await anElement(desk.backend);
    await expect(desk.backend.clickElement({ id })).rejects.toThrow(/publishes no rectangle/);
    expect(desk.presses).toEqual([]);
  });

  it("refuses an element that occupies no part of the screen", async () => {
    const desk = deskAt([10, 10, 0, 0]);
    const id = await anElement(desk.backend);
    await expect(desk.backend.clickElement({ id })).rejects.toThrow(/empty rectangle/);
    expect(desk.presses).toEqual([]);
  });

  it("refuses a rectangle that sits off the screen instead of clamping onto the desk", async () => {
    // A scrolled-away or hidden element answers with a negative origin on this
    // platform. Clamping would press whatever is at the edge of the screen and
    // report it as this element.
    const desk = deskAt([-2000, -2000, 80, 40]);
    const id = await anElement(desk.backend);
    await expect(desk.backend.clickElement({ id })).rejects.toThrow(/off the screen/);
    expect(desk.presses).toEqual([]);
  });

  it("refuses an id it never answered, in the words it uses for one that was never real", async () => {
    const desk = deskAt([0, 0, 10, 10]);
    await expect(desk.backend.clickElement({ id: "el-000000000000" })).rejects.toThrow(/was ever answered/);
    expect(desk.presses).toEqual([]);
  });
});

describe("the gates in front of the pointer", () => {
  it("refuses a session that was never given the class, without touching the desk", async () => {
    const clicked: unknown[] = [];
    const answer = await click({ id: "el-1" }, { allows: new Set() }, backendThat({ clicked }));
    expect(refusalIn(answer)).toContain('"clickElement" is rawInput-class');
    expect(refusalIn(answer)).toContain("--allow rawInput");
    expect(clicked).toEqual([]);
  });

  it("refuses on a machine with no pointer route, and names no setting for it", async () => {
    const clicked: unknown[] = [];
    const answer = await click({ id: "el-1" }, { ...ARMED, keys: undefined }, backendThat({ clicked }));
    expect(refusalIn(answer)).toContain('"clickElement" cannot be performed');
    expect(refusalIn(answer)).toContain("no setting on this daemon would change that");
    expect(clicked).toEqual([]);
  });

  it("refuses a button, a count and a fraction this contract never defined, by name", async () => {
    const clicked: unknown[] = [];
    const backend = backendThat({ clicked });
    expect(refusalIn(await click({ id: "el-1", button: "thumb" }, ARMED, backend))).toContain("left, middle, right");
    expect(refusalIn(await click({ id: "el-1", count: 5 }, ARMED, backend))).toContain("performs 1 or 2");
    expect(refusalIn(await click({ id: "el-1", x: 1.5 }, ARMED, backend))).toContain("from 0 through 1");
    expect(refusalIn(await click({ id: "el-1", y: -0.1 }, ARMED, backend))).toContain("from 0 through 1");
    expect(clicked).toEqual([]);
  });

  it("presses the element it was addressed to, at the centre unless told otherwise", async () => {
    const clicked: unknown[] = [];
    const answer = await click({ id: "el-1" }, ARMED, backendThat({ clicked }));
    expect(refusalIn(answer)).toBe("");
    expect(clicked).toEqual([{ id: "el-1", button: "left", count: 1, x: 0.5, y: 0.5 }]);
    expect((answer.result as { element?: { name?: string } }).element?.name).toBe("Mastra logo");
  });

  it("has no edge from a semantic verb into the pointer route", async () => {
    // ADR-0046 clause 3, the same assertion the raw-input verbs carry: an
    // activateElement that was refused for want of a published action must not
    // come back as a press. Two matches - the declaration and the dispatch
    // entry - because `backend.clickElement(` is excluded by the lookbehind.
    const source = readFileSync(join(here, "..", "server.ts"), "utf8");
    expect([...source.matchAll(/(?<![\w.])clickElement\(/g)]).toHaveLength(2);
    expect(source).toContain('clickElement: { effectClass: "rawInput", enforcement: "before-call"');
  });
});

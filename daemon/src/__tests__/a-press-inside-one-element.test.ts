import { refusalText } from "./refusal-text.js";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { displayBounds, emitClick } from "../backends/atspi/rawinput/pointer.js";
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

// Replace only the external executable: production querying, parsing and the
// final pre-emission guard still run, independently of accessibility geometry.
const displayTools = mkdtempSync(join(tmpdir(), "pointer-display-"));
const displayOutput = "  Absolute upper-left X: 0\n  Absolute upper-left Y: 0\n  Width: 1024\n  Height: 768\n";
const displayProgram = '#!/bin/sh\n[ "$1" = "-root" ] || exit 2\n[ "$LC_ALL" = "C" ] || exit 3\nprintf "%s\\n" "$POINTER_TEST_DISPLAY"\n';
beforeEach(() => {
  writeFileSync(join(displayTools, "xwininfo"), displayProgram, { mode: 0o700 });
  vi.stubEnv("PATH", `${displayTools}:${process.env.PATH ?? ""}`);
  vi.stubEnv("DISPLAY", ":pointer-test");
  vi.stubEnv("POINTER_TEST_DISPLAY", displayOutput);
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => rmSync(displayTools, { recursive: true, force: true }));

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
function deskAt(
  extents: [number, number, number, number] | undefined,
  // What the platform says every element here IS, and whether it says the
  // element responds to input. The tape's own answers stand unless a test
  // needs a control that is greyed out, which no tape of a working dialog has.
) {
  const tape = replayChannel("gtk-dialog");
  const presses: Press[] = [];
  let published = extents;
  let scrolled = 0;
  let afterScroll: [number, number, number, number] | undefined;
  let afterFocus: [number, number, number, number] | undefined;
  let stale = false;
  let offscreen = false;
  let focused = 0;
  const events: string[] = [];
  // What the platform says the element IS and whether it responds to input.
  // Left alone the tape answers both; a test that needs a greyed-out control
  // sets it, because no tape of a working dialog contains one.
  let control: { role: string; enabled: boolean } | undefined;
  const channel: Channel = {
    async call(exchange) {
      events.push(exchange.member);
      if (stale && exchange.member === "GetRoleName") throw new Error("element is gone");
      if (exchange.member === "GrabFocus") {
        focused += 1;
        if (afterFocus !== undefined) published = afterFocus;
        return [true];
      }
      if (control !== undefined && exchange.member === "GetRoleName") return [control.role];
      if (control !== undefined && exchange.member === "GetState") {
        return [[control.enabled ? 1 << 8 : 0, 0]];
      }
      if (offscreen && exchange.member === "GetState") return [[(1 << 8) | (1 << 30), 0]];
      if (exchange.member === "GenerateMouseEvent") {
        const body = exchange.body as unknown[];
        presses.push({ x: Number(body[0]), y: Number(body[1]), gesture: String(body[2]) });
        return [];
      }
      if (exchange.member === "ScrollTo") {
        scrolled += 1;
        if (afterScroll !== undefined) published = afterScroll;
        return [];
      }
      if (exchange.member === "GetExtents") {
        if (published === undefined) throw new Error("this element carries no Component interface");
        return [published];
      }
      return tape.call(exchange);
    },
    watch: (subscribedTo, sink, anchor) => tape.watch(subscribedTo, sink, anchor),
    close: () => tape.close(),
  };
  return {
    backend: new AtspiBackend(channel, "all"),
    presses,
    events,
    disappears() { stale = true; },
    staysOffscreen() { offscreen = true; },
    get focused() { return focused; },
    get scrolled() {
      return scrolled;
    },
    after(member: "ScrollTo" | "GrabFocus", rectangle: [number, number, number, number]) {
      if (member === "ScrollTo") afterScroll = rectangle;
      else afterFocus = rectangle;
    },
    becomes(role: string, enabled: boolean) {
      control = { role, enabled };
    },
  };
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
  return refusalText(answer) ?? "";
}

describe("aiming a press from an element's own rectangle", () => {
  it("sends a centre press and reads the element back without claiming recipient proof", async () => {
    const desk = deskAt([100, 200, 80, 40]);
    const id = await anElement(desk.backend);
    const result = await desk.backend.clickElement({ id });
    expect(result.element?.id).toBe(id);
    expect(result.element?.diagnostic).toHaveProperty("mastra-cc/pointer-aim");
    expect(desk.presses).toEqual([{ x: 140, y: 220, gesture: "b1c" }]);
  });

  it("keeps fractional edge presses inside the rectangle", async () => {
    const desk = deskAt([100, 200, 80, 40]);
    const id = await anElement(desk.backend);
    await desk.backend.clickElement({ id, x: 0, y: 1 });
    expect(desk.presses).toEqual([{ x: 100, y: 239, gesture: "b1c" }]);
  });

  it("sends the native double-click gesture", async () => {
    const desk = deskAt([0, 0, 10, 10]);
    const id = await anElement(desk.backend);
    await desk.backend.clickElement({ id, count: 2 });
    expect(desk.presses).toEqual([{ x: 5, y: 5, gesture: "b1d" }]);
  });

  it("sends right clicks and rejects unknown buttons", async () => {
    const desk = deskAt([0, 0, 10, 10]);
    const id = await anElement(desk.backend);
    await desk.backend.clickElement({ id, button: "right" });
    expect(desk.presses).toEqual([{ x: 5, y: 5, gesture: "b3c" }]);
    await expect(desk.backend.clickElement({ id, button: "thumb" })).rejects.toThrow(/no pointer button named/);
    expect(desk.presses).toHaveLength(1);
  });

  // MEASURED 2026-09-05 on the wallpaper page: Apply published ["visible"]
  // while every live button beside it published "enabled" too. A press there
  // reported success over a control that could not take it, and the errand
  // went on to report a wallpaper the desktop configuration never received.
  it("refuses a press on a control the platform greys out, rather than spending it on a dead button", async () => {
    const desk = deskAt([100, 200, 80, 40]);
    const id = await anElement(desk.backend);
    desk.becomes("push button", false);
    await expect(desk.backend.clickElement({ id })).rejects.toThrow(/reads it as disabled/);
    expect(desk.presses).toHaveLength(0);
  });

  // MEASURED 2026-09-05, by hand at the desk: Plasma's wallpaper Apply never
  // gains "enabled", under this daemon's pointer or a real xdotool click, so
  // the first refusal's advice - go and do the step it waits on - is advice
  // that cannot be taken. Told the same hopeful thing three times, a run read
  // the grey as work done quietly and reported a wallpaper nobody had set.
  it("says the road is closed, and claims nothing, when the same grey control refuses again", async () => {
    const desk = deskAt([100, 200, 80, 40]);
    const id = await anElement(desk.backend);
    desk.becomes("push button", false);

    await expect(desk.backend.clickElement({ id })).rejects.toThrow(/has not happened yet$/);
    await expect(desk.backend.clickElement({ id })).rejects.toThrow(/NOTHING HAS BEEN APPLIED/);
    await expect(desk.backend.clickElement({ id })).rejects.toThrow(/This road is closed/);
    await expect(desk.backend.clickElement({ id })).rejects.toThrow(/refusal 4 at this same control/);
    expect(desk.presses).toHaveLength(0);
  });

  // THE OTHER DOOR. Measured 2026-09-05: refused at Plasma's Apply by the
  // pointer, a run performed the button's own published `Press` instead, was
  // answered with a bare success, and reported a wallpaper the desk never
  // received. A grey control is grey through whichever door the press arrives.
  it("refuses the control's own press action at a control the platform greys out", async () => {
    const desk = deskAt([100, 200, 80, 40]);
    const id = await anElement(desk.backend);
    desk.becomes("push button", false);
    await expect(desk.backend.activateElement({ id, action: "Press" })).rejects.toThrow(/reads it as disabled/);
  });

  it("still lets a grey control be given the focus, which is how a form is filled", async () => {
    const desk = deskAt([100, 200, 80, 40]);
    const id = await anElement(desk.backend);
    desk.becomes("push button", false);
    // This tape's element publishes no Action interface at all, so the call
    // cannot succeed here - what it must not do is refuse for being GREY. The
    // refusal that comes back is about the missing interface, which is the
    // proof that the enablement guard let a non-activating verb past it.
    await expect(desk.backend.activateElement({ id, action: "SetFocus" })).rejects.toThrow(/does not expose actions/);
  });

  it("allows enabled controls without claiming recipient proof", async () => {
    const desk = deskAt([100, 200, 80, 40]);
    const id = await anElement(desk.backend);
    desk.becomes("push button", true);
    await desk.backend.clickElement({ id });
    expect(desk.presses).toEqual([{ x: 140, y: 220, gesture: "b1c" }]);
  });

  // A PAGE IS NOT A TOOLKIT. Web content publishes enablement for controls and
  // nothing at all for the generic nodes that carry most of a page's clickable
  // area; holding those to the same reading would refuse every press on a
  // search result. Only roles a toolkit greys out are checked.
  it("allows generic nodes without an enablement claim", async () => {
    const desk = deskAt([100, 200, 80, 40]);
    const id = await anElement(desk.backend);
    desk.becomes("generic", false);
    await desk.backend.clickElement({ id });
    expect(desk.presses).toEqual([{ x: 140, y: 220, gesture: "b1c" }]);
  });

  it("refuses an element the platform gives no rectangle for, rather than pressing at a default", async () => {
    const desk = deskAt(undefined);
    const id = await anElement(desk.backend);
    await expect(desk.backend.clickElement({ id })).rejects.toThrow(/rectangle/);
    expect(desk.presses).toEqual([]);
  });

  it("refuses an element that occupies no part of the screen", async () => {
    const desk = deskAt([10, 10, 0, 0]);
    const id = await anElement(desk.backend);
    await expect(desk.backend.clickElement({ id })).rejects.toThrow(/rectangle/);
    expect(desk.presses).toEqual([]);
  });

  it("accepts fresh valid geometry after reveal even when the offscreen flag stays set", async () => {
    const desk = deskAt([100, -200, 80, 40]);
    const id = await anElement(desk.backend);
    desk.staysOffscreen();
    desk.after("ScrollTo", [100, 200, 80, 40]);
    const result = await desk.backend.clickElement({ id });
    expect(result.element?.states).toContain("offscreen");
    expect(desk.scrolled).toBe(1);
    expect(desk.presses).toEqual([{ x: 140, y: 220, gesture: "b1c" }]);
  });

  it("reveals an offscreen target before reading its fresh rectangle", async () => {
    // A page element above the viewport answers with a negative origin. The
    // desk asks the element itself to scroll into view - the same operation
    // revealElement performs - and presses the rectangle it then publishes.
    const desk = deskAt([-2000, -2000, 80, 40]);
    const id = await anElement(desk.backend);
    desk.after("ScrollTo", [100, 200, 80, 40]);
    await desk.backend.clickElement({ id });
    expect(desk.scrolled).toBe(1);
    expect(desk.presses).toEqual([{ x: 140, y: 220, gesture: "b1c" }]);
  });

  it("uses geometry read after reveal AND focus, before the actual pointer callback", async () => {
    const desk = deskAt([-2000, -2000, 80, 40]);
    const id = await anElement(desk.backend);
    desk.after("ScrollTo", [100, 200, 80, 40]);
    desk.after("GrabFocus", [300, 400, 20, 20]);
    await desk.backend.clickElement({ id });
    expect(desk.scrolled).toBe(1);
    expect(desk.focused).toBe(1);
    expect(desk.presses).toEqual([{ x: 310, y: 410, gesture: "b1c" }]);
    const focus = desk.events.lastIndexOf("GrabFocus");
    const geometry = desk.events.lastIndexOf("GetExtents");
    expect(geometry).toBeGreaterThan(focus);
    expect(desk.events.indexOf("GenerateMouseEvent")).toBeGreaterThan(geometry);
  });

  it.each([[1024, 200, 80, 40], [100, 768, 80, 40], [1000, 200, 80, 40], [100, 750, 80, 40]])(
    "refuses positive off-display aiming after focus: %j", async (x, y, width, height) => {
      const desk = deskAt([100, 200, 80, 40]);
      const id = await anElement(desk.backend);
      desk.after("GrabFocus", [x, y, width, height]);
      await expect(desk.backend.clickElement({ id })).rejects.toThrow(/outside the actual display bounds/);
      expect(desk.presses).toEqual([]);
    },
  );

  it("accepts the last display pixel with stale offscreen flags", async () => {
    const desk = deskAt([100, -200, 80, 40]);
    const id = await anElement(desk.backend);
    desk.staysOffscreen();
    desk.after("ScrollTo", [1023, 767, 1, 1]);
    await desk.backend.clickElement({ id, x: 1, y: 1 });
    expect(desk.presses).toEqual([{ x: 1023, y: 767, gesture: "b1c" }]);
  });

  it.each(["", "Width: 1024\nHeight: 768", displayOutput.replace("1024", "0"),
    displayOutput.replace("768", "NaN"), displayOutput + "Width: 1024\n"])(
    "refuses unavailable or invalid display bounds without pointer emission: %j", async (output) => {
      vi.stubEnv("POINTER_TEST_DISPLAY", output);
      const desk = deskAt([100, 200, 80, 40]);
      const id = await anElement(desk.backend);
      await expect(desk.backend.clickElement({ id })).rejects.toThrow(/display bounds are unavailable/);
      expect(desk.presses).toEqual([]);
    },
  );

  it("does not infer display dimensions when DISPLAY is unavailable", async () => {
    vi.stubEnv("DISPLAY", "");
    const desk = deskAt([100, 200, 80, 40]);
    const id = await anElement(desk.backend);
    await expect(desk.backend.clickElement({ id })).rejects.toThrow(/display bounds are unavailable/);
    expect(desk.presses).toEqual([]);
  });

  it("refuses when the display query executable is missing", async () => {
    vi.stubEnv("PATH", "");
    const call = vi.fn();
    await expect(emitClick({ call }, { x: 100, y: 200 }, "left", 1)).rejects.toThrow(/display bounds are unavailable/);
    expect(call).not.toHaveBeenCalled();
  });

  it("rereads the display rather than caching its earlier dimensions", async () => {
    expect(await displayBounds()).toEqual({ x: 0, y: 0, width: 1024, height: 768 });
    vi.stubEnv("POINTER_TEST_DISPLAY", displayOutput.replace("1024", "100"));
    const call = vi.fn();
    await expect(emitClick({ call }, { x: 100, y: 200 }, "left", 1)).rejects.toThrow(/outside/);
    expect(call).not.toHaveBeenCalled();
  });

  it.each([
    '#!/bin/sh\nexit 1\n',
    '#!/bin/sh\nwhile :; do :; done\n',
    '#!/bin/sh\nwhile :; do printf "oversized display output\\n"; done\n',
  ])("bounds failing, hanging and oversized display queries", async (program) => {
    writeFileSync(join(displayTools, "xwininfo"), program, { mode: 0o700 });
    const call = vi.fn();
    await expect(emitClick({ call }, { x: 100, y: 200 }, "left", 1)).rejects.toThrow(/display bounds are unavailable/);
    expect(call).not.toHaveBeenCalled();
  });

  it("checks the rounded emitted pixel rather than the unrounded point", async () => {
    const call = vi.fn();
    await expect(emitClick({ call }, { x: 1023.6, y: 100 }, "left", 1)).rejects.toThrow(/outside/);
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses stale targets before reveal, focus, or pointer effects", async () => {
    const desk = deskAt([100, 200, 80, 40]);
    const id = await anElement(desk.backend);
    desk.disappears();
    await expect(desk.backend.clickElement({ id })).rejects.toThrow(/gone/);
    expect(desk.presses).toEqual([]);
    expect(desk.scrolled).toBe(0);
    expect(desk.focused).toBe(0);
  });

  it("refuses fresh geometry that became invalid during focus", async () => {
    const desk = deskAt([100, 200, 80, 40]);
    const id = await anElement(desk.backend);
    desk.after("GrabFocus", [300, 400, 0, 20]);
    await expect(desk.backend.clickElement({ id })).rejects.toThrow(/rectangle/);
    expect(desk.presses).toEqual([]);
  });

  it.each([{ x: NaN }, { y: Infinity }, { x: -0.1 }, { y: 1.1 }, { count: 3 }])(
    "refuses invalid native parameters %j before effects", async (params) => {
      const desk = deskAt([100, 200, 80, 40]);
      const id = await anElement(desk.backend);
      await expect(desk.backend.clickElement({ id, ...params })).rejects.toThrow();
      expect(desk.presses).toEqual([]);
      expect(desk.scrolled).toBe(0);
      expect(desk.focused).toBe(0);
    },
  );

  it("does not scroll an element that is already on the screen", async () => {
    const desk = deskAt([100, 200, 80, 40]);
    const id = await anElement(desk.backend);
    await desk.backend.clickElement({ id });
    expect(desk.scrolled).toBe(0);
  });

  it("refuses a rectangle that sits off the screen instead of clamping onto the desk", async () => {
    // A scrolled-away or hidden element answers with a negative origin on this
    // platform. Clamping would press whatever is at the edge of the screen and
    // report it as this element.
    const desk = deskAt([-2000, -2000, 80, 40]);
    const id = await anElement(desk.backend);
    await expect(desk.backend.clickElement({ id })).rejects.toThrow(/rectangle/);
    expect(desk.presses).toEqual([]);
  });

  it.each([[10, 10, -1, 40], [10, 10, 40, -1], [NaN, 0, 10, 10], [0, 0, Infinity, 10]])(
    "refuses invalid geometry %j without pointer effects", async (x, y, width, height) => {
      const desk = deskAt([x, y, width, height]);
      const id = await anElement(desk.backend);
      await expect(desk.backend.clickElement({ id })).rejects.toThrow(/rectangle/);
      expect(desk.presses).toEqual([]);
      expect(desk.scrolled).toBe(0);
    },
  );

  it("refuses an id it never answered, in the words it uses for one that was never real", async () => {
    const desk = deskAt([0, 0, 10, 10]);
    await expect(desk.backend.clickElement({ id: "el-000000000000" })).rejects.toThrow(/is known to this daemon/);
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

  // MEASURED 2026-09-17 on the live CC-01 fixture: a press that named the
  // picture it was aimed from landed on an element that had moved 120 pixels
  // since. The backend freshness check (ADR-0107) was written and tested, but
  // this function built the backend call field by field and never copied
  // capturedAt, so the claim died one frame short of the only code that could
  // check it. A dropped claim is worse than no claim: the caller is told the
  // press was checked against its picture when nothing checked anything.
  it("carries the picture a press was aimed from through to the backend that can check it", async () => {
    const clicked: unknown[] = [];
    const answer = await click({ id: "el-1", capturedAt: 1712000000123 }, ARMED, backendThat({ clicked }));
    expect(refusalIn(answer)).toBe("");
    expect(clicked).toEqual([{ id: "el-1", button: "left", count: 1, x: 0.5, y: 0.5, capturedAt: 1712000000123 }]);
  });

  it("refuses a picture named by something that is not a finite time, rather than pressing unchecked", async () => {
    for (const capturedAt of ["1712000000123", Number.NaN, Number.POSITIVE_INFINITY, null]) {
      const clicked: unknown[] = [];
      const answer = await click({ id: "el-1", capturedAt }, ARMED, backendThat({ clicked }));
      expect(refusalIn(answer)).toMatch(/names no picture this daemon could check/);
      expect(clicked).toEqual([]);
    }
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

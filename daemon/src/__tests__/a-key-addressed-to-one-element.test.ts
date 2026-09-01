import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KEY_CHORD_NAMES } from "@mastra-cc/protocol-types";
import type { Backend } from "../backend.js";
import { OwnershipTable } from "../launch/table.js";
import { handleRequest, type LaunchContext } from "../server.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// A KEY, ADDRESSED TO ONE ELEMENT (ADR-0046, ADR-0067).
//
// The authority test beside this one proves the switch is off. This file is
// about what happens after somebody turns it on, and every case here is a way
// the daemon could lie about a keystroke:
//
//   - press a key for a session that was never given the class
//   - press a key on a machine with no route, and blame a setting for it
//   - press a chord this contract never defined, by guessing at it
//   - press the key and then claim the focus came back when it did not
//   - reach a keystroke from a semantic verb that was refused
//
// The last one has no assertion that could be written against behaviour - it is
// the ABSENCE of an edge - so it is asserted against the source instead.

const here = dirname(fileURLToPath(import.meta.url));

const A_ROUTE = { route: "test-route" };

interface Pressed {
  readonly id: string;
  readonly chord: string;
}

function backendThat(options: {
  pressed: Pressed[];
  focus?: (readonly { name: string; id: string }[] | undefined)[];
  refuseFocus?: boolean;
}): Backend {
  const focusReads = [...(options.focus ?? [])];
  return {
    name: "keys-fixture",
    ...observeOnlyEffects,
    focusedElement: async () => focusReads.shift()?.[0],
    restoreFocus: async (id: string) =>
      options.refuseFocus === true ? { id: "somebody else", role: "textbox", name: "elsewhere", actions: [] } : { id, role: "textbox", name: "back", actions: [] },
    sendKeyChord: async (params: { id: string; chord: string }) => {
      options.pressed.push({ id: params.id, chord: params.chord });
      return { element: { id: params.id, role: "textbox", name: "the target", actions: [] } };
    },
    queryElements: async () => ({ elements: [] }),
    applicationOfElement: () => "kate",
    close: () => undefined,
  } as unknown as Backend;
}

async function press(chord: string, launch: Partial<LaunchContext>, backend: Backend) {
  return handleRequest(
    { type: "request", id: 1, method: "sendKeyChord", params: { id: "el-1", chord } },
    backend,
    {
      permits: new Set(),
      catalog: DEFANGED_CATALOG,
      table: new OwnershipTable(),
      visibility: "all",
      keys: A_ROUTE,
      ...launch,
    } as LaunchContext,
  );
}

// A refusal may arrive as the response's own field or inside the result, and
// which one it is is not what this file is about.
function refusalIn(answer: { refusal?: string; result?: unknown }): string {
  return answer.refusal ?? (answer.result as { refusal?: string } | undefined)?.refusal ?? "";
}

describe("a key, addressed to one element", () => {
  it("refuses a session that was never given the class, without touching the desk", async () => {
    // The gate that matters most, and it is checked BEFORE the backend: a
    // daemon that reached the key route and then declined would have already
    // grabbed somebody's focus for a keystroke it was not allowed to send.
    const pressed: Pressed[] = [];
    const answer = await press("Enter", { allows: new Set() }, backendThat({ pressed }));
    expect(refusalIn(answer)).toContain("rawInput-class");
    expect(refusalIn(answer)).toContain("--allow rawInput");
    expect(pressed).toEqual([]);
  });

  it("refuses on a machine with no key route, and names no setting for it", async () => {
    // not-exposed, not disabled-by-configuration. An operator told to add a
    // flag here would spend the afternoon on a machine that still cannot
    // deliver a key (protocol/schema.json:236).
    const pressed: Pressed[] = [];
    const answer = await press("Enter", { allows: new Set(["rawInput"]), keys: undefined }, backendThat({ pressed }));
    expect(refusalIn(answer)).toContain("no way to deliver a key here");
    expect(refusalIn(answer)).toContain("no setting on this daemon would change that");
    expect(pressed).toEqual([]);
  });

  it("refuses a chord this contract never defined, and says which ones it does", async () => {
    // The generated validator refuses this at the wire. The daemon refuses it
    // again, because relying on the client having been generated from a schema
    // the daemon cannot see is how a closed vocabulary quietly opens.
    const pressed: Pressed[] = [];
    const answer = await press("Control+Alt+Delete", { allows: new Set(["rawInput"]) }, backendThat({ pressed }));
    expect(refusalIn(answer)).toContain("does not define");
    expect(refusalIn(answer)).toContain("Enter");
    expect(pressed).toEqual([]);
  });

  // The three tests below hold the SERVER's half of the contract - what it does
  // once a route exists. No shipped platform provides one today (the test above
  // says why), so these drive the seam with a route supplied by the test. That
  // is deliberate: the authority, the closed vocabulary and the focus reporting
  // were reviewed against a real desk, and they should not have to be reviewed
  // again on the day a delivering route is written.
  it("delivers the chord it was asked for, to the element it was addressed to", async () => {
    const pressed: Pressed[] = [];
    const answer = await press("Enter", { allows: new Set(["rawInput"]) }, backendThat({ pressed }));
    expect(refusalIn(answer)).toBe("");
    expect(pressed).toEqual([{ id: "el-1", chord: "Enter" }]);
    // The element as it reads AFTERWARDS. The emission's own reply says only
    // that something was sent (ADR-0067 clause 5).
    expect((answer.result as { element?: { name?: string } }).element?.name).toBe("the target");
  });

  it("says so when the focus it borrowed did not come back", async () => {
    // ADR-0044 clause 4. A keystroke that left the keyboard somewhere the
    // caller did not ask for is not a clean keypress, and the caller is the
    // only one who can decide what to do about it.
    const pressed: Pressed[] = [];
    const backend = backendThat({
      pressed,
      focus: [[{ name: "the address bar", id: "other" }], [{ name: "the target", id: "el-1" }]],
      refuseFocus: true,
    });
    const answer = await press("Enter", { allows: new Set(["rawInput"]) }, backend);
    const note = (answer.result as { element?: { diagnostic?: Record<string, string> } }).element?.diagnostic?.[
      "mastra-cc/focus-preservation"
    ];
    expect(note ?? "").toContain("keypress");
    expect(note ?? "").toContain("the address bar");
  });

  it("claims no delivering route on any platform, because none of them delivered", async () => {
    // The measurement, kept where a future reader will trip over it: the
    // accessibility interface this route was built on accepts Enter and every
    // arrow and delivers none of them, while reporting success
    // (docs/proofs/04-a-key-addressed-to-one-element.md). Until a route exists
    // that can carry a chord, saying so is the honest answer - and a platform
    // added here without a live measurement behind it is the failure this test
    // is here to make loud.
    const { selectKeyDelivery } = await import("../rawinput/select.js");
    for (const platform of ["linux", "darwin", "win32"] as NodeJS.Platform[]) {
      expect(selectKeyDelivery(platform), platform).toBeUndefined();
    }
  });

  it("has no edge from a semantic verb into the key route", async () => {
    // ADR-0046 clause 3, asserted rather than grepped by a reader: the only
    // caller of the daemon's key handler is the dispatch table. If a future
    // edit made a failed activate or a refused setText retry as a keystroke,
    // this is the test that goes red - a daemon that answered "no" and then
    // pressed the key anyway would be escalating its own authority at exactly
    // the moment it was told not to.
    const source = readFileSync(join(here, "..", "server.ts"), "utf8");
    const callers = [...source.matchAll(/(?<![\w.])sendKeyChord\(/g)];
    // Two: the function's own declaration and the dispatch entry's call. The
    // seam call inside is `backend.sendKeyChord(`, excluded by the lookbehind,
    // so this counts edges INTO the daemon's key handler and nothing else.
    expect(callers).toHaveLength(2);
    expect(source).toContain("sendKeyChord: { effectClass: \"rawInput\", enforcement: \"before-call\"");
  });
});

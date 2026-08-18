import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UnrecordedExchangeError } from "../channel.js";
import { deniedTermsIn, readPublishedActions } from "../actions.js";
import { ReplayBackend } from "../../replay/index.js";

// The verbs an element publishes are read off the element (ADR-0043). These
// tests pin the three things that reading can get wrong: trusting the bulk
// reply, inventing an answer when the element cannot be asked, and letting a
// platform word travel silently onto a load-bearing field.

const here = dirname(fileURLToPath(import.meta.url));
const rolesSource = join(here, "..", "roles.ts");

// A scripted channel, not a hand-authored tape: this exercises reply SHAPES
// the capture target does not publish. The tapes stay recorded (the do-not
// list stands); precedent is signal-subscription.test.ts, which spreads a
// replay channel and overrides one method.
function scriptedChannel(replies: Record<string, unknown[] | (() => never)>) {
  return {
    async call(exchange: { member: string; body?: unknown[] }) {
      const key = exchange.member === "GetName" ? `GetName:${String(exchange.body?.[0])}` : exchange.member;
      const scripted = replies[key];
      if (scripted === undefined) throw new Error(`test channel: nothing scripted for ${key}`);
      if (typeof scripted === "function") return scripted();
      return scripted;
    },
  };
}

const REF = { busName: ":1.0", objectPath: "/org/a11y/atspi/accessible/16" };

describe("reading the verbs an element publishes", () => {
  it("publishes the element's own word, not the display wording the bulk reply carries", async () => {
    // Measured live and now recorded on the tape: bulk GetActions answers
    // "Click" where GetName(index) answers "click". The per-index name is the
    // answer; the bulk wording is display wording and rides as localizedName.
    const published = await readPublishedActions(
      scriptedChannel({
        GetInterfaces: [["org.a11y.atspi.Accessible", "org.a11y.atspi.Action"]],
        GetActions: [[["Click", "Clicks the button", ""]]],
        "GetName:0": ["click"],
      }),
      REF,
    );
    expect(published.actions).toEqual([
      { name: "click", availability: "available", description: "Clicks the button", localizedName: "Click" },
    ]);
    expect(published.diagnostic?.["mastra-cc/action-name-disagreement"]).toContain("click");
  });

  it("names an action the bulk reply left blank - the failure that makes a reader look broken", async () => {
    // 10 of 263 surveyed elements answered bulk with all-empty names while
    // GetName(index) named them. A reader trusting the bulk reply publishes
    // nameless actions (ADR-0045 clause 6).
    const published = await readPublishedActions(
      scriptedChannel({
        GetInterfaces: [["org.a11y.atspi.Action"]],
        GetActions: [[["", "", ""], ["", "", ""]]],
        "GetName:0": ["doDefault"],
        "GetName:1": ["showContextMenu"],
      }),
      REF,
    );
    expect(published.actions.map((a) => a.name)).toEqual(["doDefault", "showContextMenu"]);
    expect(published.actions.every((a) => a.name !== "")).toBe(true);
  });

  it("never asks an element that does not publish the interface, so a replay of the capture decides the same way", async () => {
    // The pre-flight measured 721/721 agreement. Asking anyway would record a
    // failed call in no tape, and the replay of that capture would hit an
    // unrecorded exchange - whose only escapes are relaxing replay's refusal
    // or inventing a reply.
    const published = await readPublishedActions(
      scriptedChannel({
        GetInterfaces: [["org.a11y.atspi.Accessible", "org.a11y.atspi.Component"]],
        GetActions: () => {
          throw new Error("the reader asked an element that publishes no action interface");
        },
      }),
      REF,
    );
    expect(published.actions).toEqual([]);
  });

  it("publishes no actions, and says why, when the element errors instead of answering", async () => {
    // gnome-shell and gsd-keyboard answered this with a bus error live. An
    // element that could not be asked is not an element that was asked and
    // published none, so the difference is recorded rather than flattened.
    const published = await readPublishedActions(
      scriptedChannel({
        GetInterfaces: [["org.a11y.atspi.Action"]],
        GetActions: () => {
          throw new Error("org.freedesktop.DBus.Error.Failed");
        },
      }),
      REF,
    );
    expect(published.actions).toEqual([]);
    expect(published.diagnostic?.["mastra-cc/actions-unreadable"]).toContain("Failed");
  });

  it("lets an off-tape read refuse rather than answering it with an empty list", async () => {
    // Ignorance surfaces as a refusal. An empty action list here would look
    // exactly like a measured absence, which is the lie this milestone exists
    // to stop.
    await expect(
      readPublishedActions(
        scriptedChannel({
          GetInterfaces: [["org.a11y.atspi.Action"]],
          GetActions: () => {
            throw new UnrecordedExchangeError("no recorded exchange - refusing to invent a reply");
          },
        }),
        REF,
      ),
    ).rejects.toBeInstanceOf(UnrecordedExchangeError);
  });
});

describe("a published name that carries platform vocabulary", () => {
  it("reports the term without rewriting the name a call must use", () => {
    // ADR-0047 clause 3, amendment A2. Today's live vocabulary happens to
    // contain none of the deny-listed terms; that is luck, not design. When an
    // application publishes one, dropping it hides a real affordance and
    // renaming it names a verb the element will not answer to.
    expect(deniedTermsIn("gtkClick")).toEqual(["gtk"]);
    expect(deniedTermsIn("click")).toEqual([]);
  });

  it("records the hit in the diagnostic subtree, the one place platform words may travel", async () => {
    const published = await readPublishedActions(
      scriptedChannel({
        GetInterfaces: [["org.a11y.atspi.Action"]],
        GetActions: [[["", "", ""]]],
        "GetName:0": ["gtkClick"],
      }),
      REF,
    );
    expect(published.actions[0].name).toBe("gtkClick");
    expect(published.diagnostic?.["mastra-cc/action-name-platform-term"]).toContain("gtk");
  });
});

describe("the actions a replayed element publishes", () => {
  it("come from the tape's action exchanges, and carry a word no invented table held", async () => {
    const backend = new ReplayBackend("gtk-dialog", "all");
    const { elements } = await backend.queryElements({ name: "OK", role: "button" });
    await backend.close();

    const names = elements[0].actions.map((a) => a.name);
    expect(names).toEqual(["click"]);
    // The four words the deleted table published, none of which any
    // application on this machine has ever produced.
    expect(names).not.toContain("press");
    expect(names).not.toContain("focus");
  });

  it("are absent, without refusing, on an element the tape shows publishing no interface", async () => {
    const backend = new ReplayBackend("gtk-dialog", "all");
    const { elements } = await backend.queryElements({});
    await backend.close();

    const withActions = elements.filter((e) => e.actions.length > 0);
    const without = elements.filter((e) => e.actions.length === 0);
    expect(withActions.length).toBeGreaterThan(0);
    expect(without.length).toBeGreaterThan(0);
    expect(withActions.every((e) => e.role === "button")).toBe(true);
  });
});

describe("the role-to-action table", () => {
  it("is gone from this backend, and no rename of it survives", () => {
    const source = readFileSync(rolesSource, "utf8");
    expect(source.length).toBeGreaterThan(0); // a file that failed to read would pass every assertion below
    expect(source).not.toContain("ACTIONS_BY_ROLE");
    expect(source).not.toContain("actionsForRole");
    // The invented words themselves, in case the table returns under a new name.
    expect(source).not.toContain('"press"');
  });
});

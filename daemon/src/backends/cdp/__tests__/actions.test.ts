import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CdpReplayBackend } from "../index.js";
import { deriveActions } from "../actions.js";

const here = dirname(fileURLToPath(import.meta.url));
const rolesSource = join(here, "..", "roles.ts");

// A property as Chrome publishes it - the shape measured off Chrome 151 on
// this machine, not a shape invented for the test.
const property = (name: string, value: unknown) => ({ name, value: { value } });

const groundingOf = (element: { diagnostic?: unknown }) =>
  (element.diagnostic as Record<string, string>)["mastra-cc/actions-derived-from"];

describe("the browser route's verbs", () => {
  it("come from what the node published, not from what its role suggests", () => {
    // Two nodes, same role. The AX role is identical; the published properties
    // are not. A table keyed on the role could not have told them apart, which
    // is the whole reason it is gone.
    const enabled = deriveActions([property("focusable", true), property("editable", "plaintext")]);
    const disabled = deriveActions([property("disabled", true), property("editable", "plaintext")]);

    expect(enabled.actions.map((a) => a.name)).toEqual(["focus"]);
    expect(disabled.actions).toEqual([]);
  });

  it("are withheld from a disabled element that still advertises itself as reachable", () => {
    // The case that caught an assumption of mine, measured off Chrome 151: a
    // natively disabled input drops focusable, but an ARIA-disabled one
    // publishes disabled=true and focusable=true TOGETHER. Trusting the node
    // to withdraw its own grounding property would advertise a verb on a
    // control the page has switched off.
    const ariaDisabled = deriveActions([property("disabled", true), property("focusable", true)]);

    expect(ariaDisabled.actions).toEqual([]);
    expect(ariaDisabled.diagnostic?.["mastra-cc/actions-derived-from"]).toBe("disabled");
  });

  it("name their grounding, so an empty list is never mistaken for an unasked question", () => {
    // The distinction this milestone exists to restore: a hardcoded `actions:
    // []` and a measured "nothing here grounds a verb" read identically on the
    // wire unless the answer says which one it is.
    const nothing = deriveActions([property("invalid", "false")]);
    expect(nothing.actions).toEqual([]);
    expect(nothing.diagnostic?.["mastra-cc/actions-derived-from"]).toBe("no-grounding-property");

    const something = deriveActions([property("focusable", true)]);
    expect(something.diagnostic?.["mastra-cc/actions-derived-from"]).toBe("focus<-focusable");
  });

  it("distinguish expanding from collapsing rather than collapsing them into one word", () => {
    // Measured: a closed combobox publishes expanded=false and an open one
    // publishes expanded=true. Two different things a caller could ask for, so
    // two names - ADR-0045 clause 2 forbids normalising them into a synonym.
    const closed = deriveActions([property("focusable", true), property("expanded", false)]);
    const open = deriveActions([property("focusable", true), property("expanded", true)]);

    expect(closed.actions.map((a) => a.name)).toContain("expand");
    expect(closed.actions.map((a) => a.name)).not.toContain("collapse");
    expect(open.actions.map((a) => a.name)).toContain("collapse");
    expect(open.actions.map((a) => a.name)).not.toContain("expand");
  });

  it("read a tri-state property by its published string, as Chrome sends it", () => {
    // Chrome publishes selected as a boolean but checked as the tri-state
    // strings "true"/"false"/"mixed"; a reader that only understood booleans
    // would silently derive nothing from half the vocabulary.
    const asString = deriveActions([property("selected", "false")]);
    expect(asString.actions.map((a) => a.name)).toContain("select");
  });
});

describe("a replayed browser node", () => {
  it("publishes verbs traceable to the tape's own properties", async () => {
    const backend = new CdpReplayBackend("chrome-page", "all");
    const { elements } = await backend.queryElements({});
    await backend.close();

    expect(elements.length).toBeGreaterThan(0); // a vacuous pass would satisfy every assertion below

    const button = elements.find((e) => e.role === "button" && e.name === "OK");
    expect(button).toBeDefined();
    // The tape records focusable=true on this node, and that is the entire
    // basis for the verb. No word here was chosen by role.
    expect(button?.actions.map((a) => a.name)).toEqual(["focus"]);
    expect(groundingOf(button!)).toBe("focus<-focusable");

    // Every action on every element traces back to a published property.
    for (const element of elements) {
      const grounding = groundingOf(element);
      expect(grounding).toBeDefined();
      for (const action of element.actions) {
        expect(grounding).toContain(action.name);
      }
    }
  });

  it("replays captured protected-control classification without exposing a value", async () => {
    const backend = new CdpReplayBackend("chrome-page", "all");
    const { elements } = await backend.queryElements({});
    await backend.close();

    const protectedControl = elements.find((element) => element.content.kind === "redacted");
    expect(protectedControl?.name).toContain("Account password");
    expect(protectedControl?.content).toEqual({ kind: "redacted", reason: "protected" });
    expect(protectedControl?.content).not.toHaveProperty("value");
  });

  it("does not publish the words the deleted table invented", async () => {
    const backend = new CdpReplayBackend("chrome-page", "all");
    const { elements } = await backend.queryElements({});
    await backend.close();

    expect(elements.length).toBeGreaterThan(0);
    const published = new Set(elements.flatMap((e) => e.actions.map((a) => a.name)));
    // "press" was the table's word for a button. Chrome never published it.
    expect(published.has("press")).toBe(false);
  });

  it("answers for the browser itself without pretending it was derived from a node", async () => {
    const backend = new CdpReplayBackend("chrome-page", "all");
    const { elements } = await backend.queryElements({ role: "application" });
    await backend.close();

    const application = elements[0];
    expect(application).toBeDefined();
    expect(application?.actions).toEqual([]);
    // The browser is not a node in any page's tree; the answer says so rather
    // than presenting an underived empty list as a measurement.
    expect(groundingOf(application!)).toBe("not-a-page-node");
  });
});

describe("the role-to-action table", () => {
  it("is gone from this backend, and no rename of it survives", () => {
    const source = readFileSync(rolesSource, "utf8");
    expect(source.length).toBeGreaterThan(0); // a file that failed to read would pass every assertion below
    expect(source).not.toContain("ACTIONS_BY_ROLE");
    expect(source).not.toContain("actionsForRole");
    expect(source).not.toContain('"press"');
  });
});

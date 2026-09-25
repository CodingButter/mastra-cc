import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EffectUnsupportedError } from "../../../backend.js";
import type { CdpExchange } from "../channel.js";
import { commitOf, REQUEST_SUBMIT } from "../effects.js";

// D4 (cold-agent benchmark): submitElement on this route performed the node's
// first derived action - "focus" on a button - and answered as a commit. The
// shopping-list app never heard of it; the agent reported both items added.

const REF = { targetId: "TARGET", backendDOMNodeId: 7 } as const;

// Runs the real injected function source against a stand-in `this`, the way
// the frame guard applies it in the page.
const run = (self: unknown) => (new Function(`return (${REQUEST_SUBMIT});`)() as () => unknown).call(self);

const channelAnswering = (value: unknown) => ({
  async exchange(exchange: CdpExchange): Promise<unknown> {
    if (exchange.kind !== "call") throw new Error("unexpected");
    if (exchange.method === "DOM.resolveNode") return { result: { object: { objectId: "OBJ" } } };
    return { result: { result: { value } } };
  },
  async watch(): Promise<never> {
    throw new Error("unexpected");
  },
  async close(): Promise<void> {},
});

describe("a commit on the browser route is the form's own submit, or nothing", () => {
  it("asks the owning form to submit, through its submit control", () => {
    const submitted: unknown[] = [];
    const control = { type: "submit", form: { requestSubmit: (by: unknown) => submitted.push(by) } };
    expect(run(control)).toBe("requested");
    expect(submitted).toEqual([control]);
  });

  it.each([
    ["a plain button with no form", { type: "button", form: null }],
    ["a button of type button inside a form", { type: "button", form: { requestSubmit: () => { throw new Error("submitted"); } } }],
    ["a checkbox inside a form", { type: "checkbox", form: { requestSubmit: () => { throw new Error("submitted"); } } }],
  ])("does not commit %s", (_, control) => {
    expect(run(control)).toBe("no-form");
  });

  it("refuses, as unsupported, anything that is not a form's submit control", async () => {
    await expect(commitOf(channelAnswering("no-form"), REF)).rejects.toBeInstanceOf(EffectUnsupportedError);
    await expect(commitOf(channelAnswering("requested"), REF)).resolves.toBeUndefined();
  });

  it("submitElement commits through the form, never through a derived action like focus", () => {
    const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    const body = /async submitElement\([\s\S]*?\n  \}\n/.exec(source)?.[0] ?? "";
    expect(body).toContain("await commitOf(this.channel, ref)");
    expect(body).not.toContain("performDerivedAction");
  });
});

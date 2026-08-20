import { describe, expect, it } from "vitest";
import { UnpublishedActionError, WriteNotObservedError } from "../../../backend.js";
import type { CdpExchange } from "../channel.js";
import {
  contentLength,
  contentOf,
  performDerivedAction,
  revealIn,
  setCaretOf,
  setMagnitudeOf,
  setValueOf,
} from "../effects.js";

const REF = { targetId: "TARGET", backendDOMNodeId: 24 } as const;

// A scripted channel injected at the Channel seam - the same seam the replay
// channel occupies. It drives the real backend logic against a scripted page
// and invents no tree data: every recorded tape stays a recording. It exists
// because the failures being pinned here (a page that clamps a write, a page
// that raises, a page that reports success and changes nothing) cannot be
// captured from a well-behaved fixture page - a tape can only record a browser
// doing the right thing.
const scriptedChannel = (replies: Record<string, unknown>) => {
  const asked: string[] = [];
  return {
    asked,
    async exchange(exchange: CdpExchange): Promise<unknown> {
      if (exchange.kind !== "call") throw new Error(`test channel: unexpected ${exchange.kind}`);
      const params = exchange.params as Record<string, unknown> | undefined;
      // Keyed by method, and for a function call by the function's own source,
      // because a write and the read-back that checks it are two different
      // calls on the same method.
      const key =
        exchange.method === "Runtime.callFunctionOn"
          ? `callFunctionOn:${String(params?.functionDeclaration ?? "").slice(0, 47)}`
          : exchange.method;
      asked.push(key);
      if (!(key in replies)) throw new Error(`test channel: nothing scripted for ${key}`);
      return replies[key];
    },
    async watch(): Promise<never> {
      throw new Error("test channel: not a watching test");
    },
    async close(): Promise<void> {},
  };
};

// The reply shape measured off a live headless Chrome: the object rides under
// `result`, and its objectId is the handle every call below is made against.
const RESOLVES = { "DOM.resolveNode": { result: { object: { objectId: "OBJ-1" } } } };
const returns = (value: unknown) => ({ result: { result: { value } } });

describe("the browser route's write is verified by reading it back", () => {
  it("reports a write the page clamped rather than the write that was asked for", async () => {
    // Measured shape, not an invented one: an input with a maxlength silently
    // keeps what fits and reports success. The desktop platform does the same
    // thing with an insert past the end, which is why both routes check.
    const channel = scriptedChannel({
      ...RESOLVES,
      "callFunctionOn:function(v){ this.value = v; this.dispatchEvent": returns(undefined),
      "callFunctionOn:function(){ return this.value; }": returns("typed by the"),
    });

    await expect(setValueOf(channel, REF, "typed by the daemon")).rejects.toBeInstanceOf(WriteNotObservedError);
    await expect(setValueOf(channel, REF, "typed by the daemon")).rejects.toThrow(/reading it back found/);
  });

  it("accepts a write only when the element reads back holding exactly what was intended", async () => {
    const channel = scriptedChannel({
      ...RESOLVES,
      "callFunctionOn:function(v){ this.value = v; this.dispatchEvent": returns(undefined),
      "callFunctionOn:function(){ return this.value; }": returns("typed by the daemon"),
    });

    await expect(setValueOf(channel, REF, "typed by the daemon")).resolves.toBeUndefined();
    // The read-back is a SEPARATE call, not the write's own return value: the
    // whole point is that the write's answer is not evidence.
    expect(channel.asked.filter((method) => method.startsWith("callFunctionOn"))).toHaveLength(2);
  });

  it("reports a page exception instead of treating the call as performed", async () => {
    // A page exception answers the protocol call NORMALLY and reports the
    // failure inside the reply. A route that only catches thrown errors would
    // call this a success.
    const channel = scriptedChannel({
      ...RESOLVES,
      "callFunctionOn:function(v){ this.value = v; this.dispatchEvent": { exceptionDetails: { text: "Cannot set property value" } },
    });

    await expect(setValueOf(channel, REF, "anything")).rejects.toThrow(/the page raised an exception/);
  });

  it("reports a magnitude the page clamped, rather than the number that was aimed for", async () => {
    const channel = scriptedChannel({
      ...RESOLVES,
      "callFunctionOn:function(v){ this.value = String(v); this.dispa": returns(undefined),
      "callFunctionOn:function(){ return Number(this.value); }": returns(100),
    });

    await expect(setMagnitudeOf(channel, REF, 250)).rejects.toThrow(/found 100 where 250 was intended/);
  });
});

describe("the browser route performs only what the node published", () => {
  it("refuses an action the node never published, and names what it does publish", async () => {
    const channel = scriptedChannel({ ...RESOLVES });

    // "press" is the deleted table's word, and it is semantically close to the
    // published "focus". Performing the nearest match is precisely the mistake
    // this milestone deleted.
    await expect(performDerivedAction(channel, REF, "press", ["focus", "expand"])).rejects.toBeInstanceOf(
      UnpublishedActionError,
    );
    await expect(performDerivedAction(channel, REF, "press", ["focus", "expand"])).rejects.toThrow(
      /it publishes \["focus","expand"\]/,
    );
    // Refused BEFORE the call: nothing was resolved and nothing was performed.
    expect(channel.asked).toEqual([]);
  });

  it("performs the published action and confirms it took effect", async () => {
    const channel = scriptedChannel({
      ...RESOLVES,
      "callFunctionOn:function(){ this.focus(); return document.activ": returns(true),
    });

    await expect(performDerivedAction(channel, REF, "focus", ["focus"])).resolves.toBeUndefined();
  });

  it("reports an action that returned success but did not take effect", async () => {
    // Measured on this route: a scripted click on a disclosure returned false
    // while the tree afterwards showed it HAD collapsed - so a return value is
    // not evidence in either direction. The check reads the element's own state
    // back, and disagreement is reported rather than absorbed.
    const channel = scriptedChannel({
      ...RESOLVES,
      "callFunctionOn:function(){ this.focus(); return document.activ": returns(false),
    });

    await expect(performDerivedAction(channel, REF, "focus", ["focus"])).rejects.toBeInstanceOf(WriteNotObservedError);
  });

  it("keeps expand and collapse as two verbs acting from opposite sides", async () => {
    const opened = scriptedChannel({
      ...RESOLVES,
      "callFunctionOn:function(){ if ('open' in this) { this.open = t": returns(true),
    });
    await expect(performDerivedAction(opened, REF, "expand", ["expand"])).resolves.toBeUndefined();
    // The two verbs must not collapse into one call with a flag: asking to
    // expand an element that publishes only `collapse` is refused by name.
    const closed = scriptedChannel({ ...RESOLVES });
    await expect(performDerivedAction(closed, REF, "expand", ["collapse"])).rejects.toBeInstanceOf(
      UnpublishedActionError,
    );
  });
});

describe("the browser route reads and reveals", () => {
  it("reads content off the element, since the tree does not publish it", async () => {
    const channel = scriptedChannel({
      ...RESOLVES,
      "callFunctionOn:function(){ return String(this.value ?? ''); }": returns("already full"),
    });

    expect(await contentOf(channel, REF)).toBe("already full");
  });

  it("measures length off the element so an offset can be refused before the call", async () => {
    const channel = scriptedChannel({
      ...RESOLVES,
      "callFunctionOn:function(){ return String(this.value ?? '').len": returns(9),
    });

    expect(await contentLength(channel, REF)).toBe(9);
  });

  it("places the caret where it was asked and reports it landing elsewhere", async () => {
    const landed = scriptedChannel({
      ...RESOLVES,
      "callFunctionOn:function(o){ const at = o < 0 ? this.value.leng": returns(4),
    });
    await expect(setCaretOf(landed, REF, 4)).resolves.toBeUndefined();

    const clamped = scriptedChannel({
      ...RESOLVES,
      "callFunctionOn:function(o){ const at = o < 0 ? this.value.leng": returns(9),
    });
    await expect(setCaretOf(clamped, REF, 4)).rejects.toThrow(/found it at 9 where 4 was intended/);
  });

  it("reveals through the page's own visibility call, never a pixel coordinate", async () => {
    const channel = scriptedChannel({
      ...RESOLVES,
      "callFunctionOn:function(){ this.scrollIntoView({block:'nearest": returns(undefined),
      "callFunctionOn:function(){ const r = this.getBoundingClientRec": returns(true),
    });

    await expect(revealIn(channel, REF)).resolves.toBeUndefined();
    // Reveal asked the page to make the element visible. It did not name a
    // position: a scroll offset is a promise about one viewport (ADR-0045).
    const performed = channel.asked.join(" ");
    expect(performed).toContain("scrollIn");
    expect(performed, "reveal must not carry a coordinate").not.toMatch(/scrollTo|scrollTop|window\.scroll/);
  });

  it("refuses a reveal that left the element outside the viewport, rather than reporting the scroll's own success", async () => {
    // `scrollIntoView` returns nothing whether or not the element arrived: a
    // fixed ancestor, a zero-size box or a container that cannot scroll all
    // leave it where it was, silently. The element's own rect is what settles
    // it, and only a boolean crosses back - no coordinate is published.
    const channel = scriptedChannel({
      ...RESOLVES,
      "callFunctionOn:function(){ this.scrollIntoView({block:'nearest": returns(undefined),
      "callFunctionOn:function(){ const r = this.getBoundingClientRec": returns(false),
    });

    await expect(revealIn(channel, REF)).rejects.toThrow(WriteNotObservedError);
    await expect(revealIn(channel, REF)).rejects.toThrow(/still outside the viewport/);
  });
});

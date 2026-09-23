import { describe, expect, it } from "vitest";
import { EffectUnsupportedError, UnpublishedActionError, WriteNotObservedError } from "../../../backend.js";
import { ISOLATED_WORLD } from "../subtree-stream.js";
import type { CdpExchange } from "../channel.js";
import {
  contentLength,
  contentOf,
  performDerivedAction,
  revealIn,
  setCaretOf,
  setMagnitudeOf,
  setValueOf,
  WRITE_AND_SETTLE,
} from "../effects.js";

const WRITE_KEY = `callFunctionOn:${WRITE_AND_SETTLE.slice(0, 47)}`;

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
      // Every effect function arrives wrapped in the frame guard; the key is
      // the function the guard wraps.
      const declaration = String(params?.functionDeclaration ?? "");
      const inner = /return await \(((?:async )?function[\s\S]*)\)\.apply\(this, a\); \}$/.exec(declaration)?.[1] ?? declaration;
      const key =
        exchange.method === "Runtime.callFunctionOn"
          ? `callFunctionOn:${inner.slice(0, 47)}`
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
      [WRITE_KEY]: returns(undefined),
      "callFunctionOn:function(){ return this.value; }": returns("typed by the"),
    });

    await expect(setValueOf(channel, REF, "typed by the daemon")).rejects.toBeInstanceOf(WriteNotObservedError);
    await expect(setValueOf(channel, REF, "typed by the daemon")).rejects.toThrow(/reading it back found/);
  });

  it("accepts a write only when the element reads back holding exactly what was intended", async () => {
    const channel = scriptedChannel({
      ...RESOLVES,
      [WRITE_KEY]: returns(undefined),
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
      [WRITE_KEY]: { exceptionDetails: { text: "Cannot set property value" } },
    });

    await expect(setValueOf(channel, REF, "anything")).rejects.toThrow(/the page raised an exception/);
  });

  it("reports a magnitude the page clamped, rather than the number that was aimed for", async () => {
    const channel = scriptedChannel({
      ...RESOLVES,
      [WRITE_KEY]: returns(undefined),
      "callFunctionOn:function(){ return this.value; }": returns("100"),
    });

    await expect(setMagnitudeOf(channel, REF, 250)).rejects.toThrow(/found "100" where "250" was intended/);
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
      // The read-back: the page's own answer to whether the element's box now
      // meets the viewport. A separate call, as every other write's check is.
      "callFunctionOn:function(){ const b = this.getBoundingClientRec": returns(true),
    });

    await expect(revealIn(channel, REF)).resolves.toBeUndefined();
    // Reveal asked the page to make the element visible. It did not name a
    // position: a scroll offset is a promise about one viewport (ADR-0045).
    const performed = channel.asked.join(" ");
    expect(performed).toContain("scrollIn");
    expect(performed, "reveal must not carry a coordinate").not.toMatch(/scrollTop|window\.scroll/);
  });

  it("refuses a reveal the page did not actually make, rather than reporting it as done", async () => {
    // scrollIntoView never throws and never reports: a display:none ancestor
    // or a container that does not scroll leaves the element exactly where it
    // was, and the call answers the same way it does on success.
    const channel = scriptedChannel({
      ...RESOLVES,
      "callFunctionOn:function(){ this.scrollIntoView({block:'nearest": returns(undefined),
      "callFunctionOn:function(){ const b = this.getBoundingClientRec": returns(false),
    });

    await expect(revealIn(channel, REF)).rejects.toBeInstanceOf(WriteNotObservedError);
  });
});

describe("the browser route acts from the daemon's own world", () => {
  const recorder = (value: (declaration: string) => unknown) => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    return {
      calls,
      async exchange(exchange: CdpExchange): Promise<unknown> {
        if (exchange.kind !== "call") throw new Error("unexpected");
        const params = (exchange.params ?? {}) as Record<string, unknown>;
        calls.push({ method: exchange.method, params });
        if (exchange.method === "DOM.resolveNode") return RESOLVES["DOM.resolveNode"];
        // awaitPromise: the page settles an async function before answering.
        return returns(await value(String(params.functionDeclaration)));
      },
      async watch(): Promise<never> {
        throw new Error("unexpected");
      },
      async close(): Promise<void> {},
    };
  };

  it("resolves every element into the isolated world and guards every function by its document", async () => {
    const channel = recorder((d) => (d.includes("String(this.value") ? "abc" : undefined));
    await contentOf(channel, REF);
    const resolve = channel.calls.find((c) => c.method === "DOM.resolveNode");
    expect(resolve?.params).toEqual({ backendNodeId: 24, executionContextId: ISOLATED_WORLD });
    for (const call of channel.calls.filter((c) => c.method === "Runtime.callFunctionOn")) {
      expect(String(call.params.functionDeclaration)).toContain("this.ownerDocument !== document");
    }
    expect(channel.calls.some((c) => c.method === "DOM.describeNode")).toBe(false);
  });

  it("refuses an element in another frame's document and does nothing to it", async () => {
    // Run the real guarded declaration against an element whose document is
    // not the world's: the wrapped effect must never execute.
    let touched = false;
    const frameDocument = {};
    const element = { ownerDocument: frameDocument, set value(_v: string) { touched = true; }, dispatchEvent() {} };
    const channel = recorder((declaration) => {
      const run = new Function("document", `return (${declaration});`)({}) as (this: unknown, ...a: unknown[]) => unknown;
      return run.call(element, "x");
    });
    await expect(contentOf(channel, REF)).rejects.toBeInstanceOf(EffectUnsupportedError);
    await expect(setValueOf(channel, REF, "x")).rejects.toThrow(/in a frame this session cannot reach/);
    expect(touched).toBe(false);
  });
});

// A controlled input, the shape a framework gives one: the framework installs
// its own `value` property on the instance to hear assignments, while the real
// value lives behind the prototype's native setter. The real injected functions
// run against it, with the page's timers supplied as the world would have them.
describe("the browser route writes the way a framework hears it, and claims only what settles", () => {
  type Stub = {
    element: Record<string, unknown>;
    nativeSets: string[];
    ownSets: string[];
  };
  const controlledInput = (opts: { canonical?: (v: string) => string; revertAfterMs?: number } = {}): Stub => {
    const nativeSets: string[] = [];
    const ownSets: string[] = [];
    let actual = "";
    const proto = {
      get value() { return actual; },
      set value(v: string) { nativeSets.push(v); actual = opts.canonical ? opts.canonical(v) : v; },
    };
    const element = Object.create(proto) as Record<string, unknown>;
    const document = {};
    Object.defineProperty(element, "value", {
      configurable: true,
      get() { return actual; },
      set(v: string) { ownSets.push(v); },
    });
    element.ownerDocument = document;
    element.dispatchEvent = (event: { type: string }) => {
      if (event.type === "input" && opts.revertAfterMs !== undefined) {
        setTimeout(() => { actual = ""; }, opts.revertAfterMs);
      }
      return true;
    };
    (element as { __doc: unknown }).__doc = document;
    return { element, nativeSets, ownSets };
  };

  const page = (stub: Stub, frames: { raf: boolean; frameMs?: number }) => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const raf = (f: () => void) => (frames.raf ? (setTimeout(f, frames.frameMs ?? 16) as unknown as number) : 0);
    const channel = {
      calls,
      async exchange(exchange: CdpExchange): Promise<unknown> {
        if (exchange.kind !== "call") throw new Error("unexpected");
        const params = (exchange.params ?? {}) as Record<string, unknown>;
        calls.push({ method: exchange.method, params });
        if (exchange.method === "DOM.resolveNode") return RESOLVES["DOM.resolveNode"];
        const run = new Function(
          "document", "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "Event",
          `return (${String(params.functionDeclaration)});`,
        )(
          (stub.element as { __doc: unknown }).__doc, raf, (id: number) => clearTimeout(id), setTimeout, clearTimeout,
          class { constructor(public type: string) {} },
        ) as (this: unknown, ...a: unknown[]) => unknown;
        const args = ((params.arguments ?? []) as Array<{ value: unknown }>).map((a) => a.value);
        const result = run.apply(stub.element, args);
        // Without awaitPromise the page answers with the promise, not its value.
        const value = params.awaitPromise === true ? await result : result instanceof Promise ? {} : result;
        return returns(value);
      },
      async watch(): Promise<never> { throw new Error("unexpected"); },
      async close(): Promise<void> {},
    };
    return channel;
  };

  it("asks the page to settle its async functions and answer by value", async () => {
    const stub = controlledInput();
    const channel = page(stub, { raf: true });
    await setValueOf(channel, REF, "hello");
    const fnCalls = channel.calls.filter((c) => c.method === "Runtime.callFunctionOn");
    expect(fnCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of fnCalls) {
      expect(call.params.awaitPromise).toBe(true);
      expect(call.params.returnByValue).toBe(true);
    }
  });

  it("writes through the prototype's native setter, not the framework's own property", async () => {
    const stub = controlledInput();
    await expect(setValueOf(page(stub, { raf: true }), REF, "hello")).resolves.toBeUndefined();
    expect(stub.nativeSets).toEqual(["hello"]);
    expect(stub.ownSets).toEqual([]);
  });

  it("reads back only after the settle, so a revert inside the window is refused naming what stayed", async () => {
    const stub = controlledInput({ revertAfterMs: 10 });
    const write = setValueOf(page(stub, { raf: true }), REF, "hello");
    await expect(write).rejects.toBeInstanceOf(WriteNotObservedError);
    await expect(setValueOf(page(controlledInput({ revertAfterMs: 10 }), { raf: true }), REF, "hello")).rejects.toThrow(/found ""/);
  });

  it("waits at least 20 ms even when two frames pass at once, so a 10 ms revert is still seen", async () => {
    const write = setValueOf(page(controlledInput({ revertAfterMs: 10 }), { raf: true, frameMs: 0 }), REF, "hello");
    await expect(write).rejects.toThrow(/found ""/);
  });

  it("settles on the 50 ms timer when a background tab never gives an animation frame", async () => {
    const stub = controlledInput();
    const started = Date.now();
    await expect(setValueOf(page(stub, { raf: false }), REF, "hello")).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("refuses a number the control canonicalised, naming what it holds", async () => {
    const canonical = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? "" : String(Number(v)));
    await expect(setValueOf(page(controlledInput({ canonical }), { raf: true }), REF, "01")).rejects.toThrow(/found "1"/);
    await expect(setValueOf(page(controlledInput({ canonical }), { raf: true }), REF, "abc")).rejects.toThrow(/found ""/);
    await expect(setMagnitudeOf(page(controlledInput({ canonical }), { raf: true }), REF, 42)).resolves.toBeUndefined();
    await expect(setValueOf(page(controlledInput({ canonical }), { raf: true }), REF, "7")).resolves.toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CDP_CALL_DEADLINE_MS,
  CDP_INIT_DEADLINE_MS,
  CdpDeadlineError,
  CdpUnreachableError,
  DialogBlockingError,
  liveCdpChannel,
} from "../channel.js";

// The live channel's waits, driven by fake timers and an in-memory socket.
// Nothing here dials a browser: the socket is a stand-in that records what
// was sent and answers only when the test says so, which is exactly the
// browser that goes silent.

type Listener = (event: { data?: unknown }) => void;

class FakeSocket {
  static last: FakeSocket | undefined;
  static opens = true;
  // Initialisation the fake answers by itself unless a test withholds it.
  static answers = new Set(["Page.enable", "Page.getFrameTree"]);
  static all: FakeSocket[] = [];
  readonly frames: Array<{ id: number; method: string }> = [];
  readonly sent: Array<{ id: number; method: string }> = [];
  readonly listeners = new Map<string, Set<Listener>>();
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.last = this;
    FakeSocket.all.push(this);
    if (FakeSocket.opens) queueMicrotask(() => this.emit("open", {}));
  }
  addEventListener(type: string, listener: Listener) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }
  send(data: string) {
    const frame = JSON.parse(data) as { id: number; method: string };
    this.frames.push(frame);
    if (frame.method === "Page.enable" || frame.method === "Page.getFrameTree") {
      if (FakeSocket.answers.has(frame.method)) {
        const result = frame.method === "Page.getFrameTree" ? { frameTree: { frame: { id: "F-main" } } } : {};
        queueMicrotask(() => this.reply(frame.id, result));
      }
      return;
    }
    this.sent.push(frame);
  }
  event(method: string, params: Record<string, unknown> = {}) {
    this.emit("message", { data: JSON.stringify({ method, params }) });
  }
  close() {
    this.closed = true;
  }
  emit(type: string, event: { data?: unknown }) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
  reply(id: number, result: unknown = {}) {
    this.emit("message", { data: JSON.stringify({ id, result }) });
  }
  listenerCount() {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}

const TARGET = { id: "T1", webSocketDebuggerUrl: "ws://fake/T1" };

function answeringFetch(): typeof fetch {
  return (async (url: string) =>
    new Response(JSON.stringify(String(url).endsWith("/json/list") ? [TARGET] : { Browser: "Chrome/1" }))) as typeof fetch;
}

function channel(fetchImpl: typeof fetch = answeringFetch()) {
  return liveCdpChannel("http://fake", { WebSocket: FakeSocket as unknown as typeof WebSocket, fetch: fetchImpl });
}

async function listed() {
  const c = channel();
  await c.exchange({ kind: "list" });
  return c;
}

const call = (method = "DOM.getDocument") => ({ kind: "call", targetId: TARGET.id, method, params: {} }) as const;

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.last = undefined;
  FakeSocket.opens = true;
  FakeSocket.answers = new Set(["Page.enable", "Page.getFrameTree"]);
  FakeSocket.all = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a call the browser never answers", () => {
  it("rejects with CdpDeadlineError at the deadline, leaving no pending call or timer", async () => {
    const c = await listed();
    const answer = c.exchange(call()).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(CDP_CALL_DEADLINE_MS - 1);
    expect(FakeSocket.last!.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const error = await answer;
    expect(error).toBeInstanceOf(CdpDeadlineError);
    expect(error).toMatchObject({ method: "DOM.getDocument", effectSent: true });
    expect(c.pendingCalls()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores the reply that arrives after its call timed out", async () => {
    const c = await listed();
    const answer = c.exchange(call()).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(CDP_CALL_DEADLINE_MS);
    expect(await answer).toBeInstanceOf(CdpDeadlineError);
    const socket = FakeSocket.last!;
    expect(() => socket.reply(socket.sent[0]!.id, { late: true })).not.toThrow();
    // The socket still serves the next call.
    const next = c.exchange(call("DOM.enable"));
    await vi.advanceTimersByTimeAsync(0);
    socket.reply(socket.sent[1]!.id, { ok: 1 });
    expect(await next).toEqual({ result: { ok: 1 } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is rejected with every other pending call when the socket closes, and their timers go too", async () => {
    const c = await listed();
    const answers = [1, 2, 3].map(() => c.exchange(call()).catch((e: unknown) => e));
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last!.emit("close", {});
    for (const answer of answers) expect(await answer).toBeInstanceOf(CdpUnreachableError);
    expect(c.pendingCalls()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a malformed frame while a valid reply still resolves", async () => {
    const c = await listed();
    const answer = c.exchange(call());
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.last!;
    socket.emit("message", { data: "{not json" });
    socket.reply(socket.sent[0]!.id, { root: 1 });
    expect(await answer).toEqual({ result: { root: 1 } });
  });

  it("adds no listener per call: 1 and 50 concurrent calls leave the same count", async () => {
    const c = await listed();
    const one = c.exchange(call());
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.last!;
    const withOne = socket.listenerCount();
    const fifty = Array.from({ length: 50 }, () => c.exchange(call()));
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.listenerCount()).toBe(withOne);
    for (const frame of socket.sent) socket.reply(frame.id);
    await Promise.all([one, ...fifty]);
  });
});

describe("the stages before a call", () => {
  it("bounds opening the socket", async () => {
    FakeSocket.opens = false;
    const c = await listed();
    const answer = c.exchange(call()).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(CDP_CALL_DEADLINE_MS);
    expect(await answer).toMatchObject({ method: "open", effectSent: false });
    expect(await answer).toBeInstanceOf(CdpDeadlineError);
    expect(FakeSocket.last!.closed).toBe(true);
  });

  it("bounds discovery: a fetch that never answers is aborted at the deadline", async () => {
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch;
    const c = channel(hanging);
    const answer = c.exchange({ kind: "list" }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(CDP_CALL_DEADLINE_MS);
    expect(await answer).toBeInstanceOf(CdpDeadlineError);
    expect(await answer).toMatchObject({ method: "discovery", effectSent: false });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("a watch", () => {
  it("sends through the same deadline as every exchange", async () => {
    const c = await listed();
    const watching = c
      .watch("el-x", () => undefined, { targetId: TARGET.id, backendDOMNodeId: 5, role: "generic" })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(CDP_CALL_DEADLINE_MS);
    const error = await watching;
    expect(error).toBeInstanceOf(CdpDeadlineError);
    expect(error).toMatchObject({ method: "Runtime.enable" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("attaching to a target", () => {
  for (const stalled of ["Page.enable", "Page.getFrameTree"]) {
    it(`refuses at the attach deadline when ${stalled} never answers, and drops the socket`, async () => {
      FakeSocket.answers.delete(stalled);
      const c = await listed();
      const first = c.exchange(call()).catch((e: unknown) => e);
      const queued = c.exchange(call("DOM.enable")).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(CDP_INIT_DEADLINE_MS);
      for (const answer of [first, queued]) {
        const error = await answer;
        expect(error).toBeInstanceOf(CdpDeadlineError);
        expect(error).toMatchObject({ method: stalled, effectSent: false });
      }
      const socket = FakeSocket.last!;
      expect(socket.sent).toHaveLength(0);
      expect(socket.closed).toBe(true);
      expect(c.pendingCalls()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      // Evicted: the next call attaches afresh.
      FakeSocket.answers.add(stalled);
      const again = c.exchange(call()).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(0);
      expect(FakeSocket.all).toHaveLength(2);
      FakeSocket.last!.reply(FakeSocket.last!.sent[0]!.id, { ok: 1 });
      expect(await again).toEqual({ result: { ok: 1 } });
    });
  }

  it("enables Page before anything else is sent", async () => {
    const c = await listed();
    const answer = c.exchange(call());
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.last!;
    expect(socket.frames.map((f) => f.method)).toEqual(["Page.enable", "Page.getFrameTree", "DOM.getDocument"]);
    socket.reply(socket.sent[0]!.id);
    await answer;
  });
});

describe("a native dialog on the page", () => {
  it("rejects every pending call at once with DialogBlockingError, leaving no timers", async () => {
    const c = await listed();
    const answers = [call(), call("DOM.enable"), call("Runtime.evaluate")].map((e) => c.exchange(e).catch((x: unknown) => x));
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last!.event("Page.javascriptDialogOpening", { type: "alert", message: "hi there" });
    for (const answer of answers) {
      const error = await answer;
      expect(error).toBeInstanceOf(DialogBlockingError);
      expect(error).toMatchObject({ type: "alert", dialogMessage: "hi there", effectSent: true });
    }
    expect(c.pendingCalls()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is heard on a socket no watch listens to, refuses new calls unsent, and lifts when it closes", async () => {
    const c = await listed();
    const first = c.exchange(call());
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.last!;
    socket.reply(socket.sent[0]!.id);
    await first;
    socket.event("Page.javascriptDialogOpening", { type: "confirm", message: "sure?" });
    const refused = await c.exchange(call("DOM.enable")).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(DialogBlockingError);
    expect(refused).toMatchObject({ type: "confirm", method: "DOM.enable", effectSent: false });
    expect(socket.sent).toHaveLength(1);
    socket.event("Page.javascriptDialogClosed", { result: true });
    const next = c.exchange(call("DOM.enable"));
    await vi.advanceTimersByTimeAsync(0);
    socket.reply(socket.sent[1]!.id, { ok: 1 });
    expect(await next).toEqual({ result: { ok: 1 } });
  });

  it("opening during attach refuses as a dialog, keeps the socket, and re-attaches after it closes", async () => {
    FakeSocket.answers.delete("Page.enable");
    const c = await listed();
    const answer = c.exchange(call()).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.last!;
    socket.event("Page.javascriptDialogOpening", { type: "alert", message: "x" });
    const error = await answer;
    expect(error).toBeInstanceOf(DialogBlockingError);
    expect(error).toMatchObject({ effectSent: false });
    expect(socket.closed).toBe(false);
    FakeSocket.answers.add("Page.enable");
    socket.event("Page.javascriptDialogClosed");
    const next = c.exchange(call());
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeSocket.all).toHaveLength(1);
    expect(socket.frames.filter((f) => f.method === "Page.enable")).toHaveLength(2);
    socket.reply(socket.sent[0]!.id, { ok: 1 });
    expect(await next).toEqual({ result: { ok: 1 } });
  });

  it("is never answered by the daemon", async () => {
    const c = await listed();
    const answer = c.exchange(call()).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.last!.event("Page.javascriptDialogOpening", { type: "alert", message: "x" });
    await answer;
    await c.exchange(call()).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(CDP_CALL_DEADLINE_MS);
    for (const socket of FakeSocket.all) {
      expect(socket.frames.some((f) => f.method.includes("handleJavaScriptDialog"))).toBe(false);
    }
  });
});

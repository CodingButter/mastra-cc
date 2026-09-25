import type { Readable, Writable } from "node:stream";
import type { LiveCdpDeps } from "./channel.js";

// THE BROWSER THE DAEMON LAUNCHED IS REACHED ONLY THROUGH THE DAEMON (H2).
//
// A browser started with --remote-debugging-port answers any local process on
// that port: the daemon's grants and receipts are a door beside an open
// window. The daemon's own browser is started with --remote-debugging-pipe
// instead - the protocol runs over fds 3 (the browser reads) and 4 (the
// browser writes), NUL-delimited JSON, and no port is opened at all.
//
// The CDP channel was written against HTTP discovery plus one WebSocket per
// target. Rather than fork it, the pipe presents the same two seams: `fetch`
// answers /json/version and /json/list from Browser.getVersion and
// Target.getTargets, and each "WebSocket" is a flattened session from
// Target.attachToTarget. The channel's deadlines, dialog handling and
// isolated world are therefore the same code on both routes.

type Listener = (event: { data?: string }) => void;
type Message = { id?: number; sessionId?: string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } };

export class PipeBrowser {
  #buffer = "";
  #nextId = 1;
  #closed = false;
  readonly #pending = new Map<number, (message: Message) => void>();
  readonly #sessions = new Map<string, PipeSession>();

  constructor(private readonly toBrowser: Writable, fromBrowser: Readable) {
    fromBrowser.setEncoding("utf8");
    fromBrowser.on("data", (chunk: string) => this.#receive(chunk));
    const gone = () => this.#close();
    fromBrowser.on("close", gone);
    fromBrowser.on("error", gone);
    toBrowser.on("error", gone);
  }

  get closed(): boolean {
    return this.#closed;
  }

  #receive(chunk: string): void {
    this.#buffer += chunk;
    let end: number;
    while ((end = this.#buffer.indexOf("\0")) >= 0) {
      const line = this.#buffer.slice(0, end);
      this.#buffer = this.#buffer.slice(end + 1);
      let message: Message;
      try {
        message = JSON.parse(line) as Message;
      } catch {
        continue;
      }
      if (message.sessionId !== undefined) {
        const { sessionId, ...rest } = message;
        this.#sessions.get(sessionId)?.deliver(JSON.stringify(rest));
        continue;
      }
      if (message.id !== undefined) {
        const settle = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        settle?.(message);
        continue;
      }
      if (message.method === "Target.detachedFromTarget") {
        const sessionId = message.params?.sessionId;
        if (typeof sessionId === "string") this.#sessions.get(sessionId)?.gone();
      }
    }
  }

  #close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const settle of this.#pending.values()) settle({ error: { message: "the browser's pipe closed" } });
    this.#pending.clear();
    for (const session of [...this.#sessions.values()]) session.gone();
  }

  write(message: Record<string, unknown>): boolean {
    if (this.#closed) return false;
    this.toBrowser.write(`${JSON.stringify(message)}\0`);
    return true;
  }

  /** A browser-level call. The channel bounds every wait; this only routes. */
  call(method: string, params: Record<string, unknown> = {}): Promise<Message> {
    if (this.#closed) return Promise.resolve({ error: { message: "the browser's pipe closed" } });
    const id = this.#nextId++;
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.write({ id, method, params });
    });
  }

  register(sessionId: string, session: PipeSession): void {
    this.#sessions.set(sessionId, session);
  }

  unregister(sessionId: string): void {
    this.#sessions.delete(sessionId);
  }

  /** The channel's two seams, answered over the pipe. */
  deps(): Required<LiveCdpDeps> {
    const browser = this;
    const fetchOverPipe = async (input: string | URL | Request): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      let body: unknown;
      if (path === "/json/version") {
        const reply = await browser.call("Browser.getVersion");
        if (reply.error !== undefined) throw new Error(reply.error.message);
        const v = reply.result as { product?: string; protocolVersion?: string; userAgent?: string };
        body = { Browser: v.product, "Protocol-Version": v.protocolVersion, "User-Agent": v.userAgent, webSocketDebuggerUrl: "pipe:browser" };
      } else if (path === "/json/list") {
        const reply = await browser.call("Target.getTargets");
        if (reply.error !== undefined) throw new Error(reply.error.message);
        const infos = (reply.result as { targetInfos?: Array<Record<string, unknown>> }).targetInfos ?? [];
        body = infos.map((t) => ({ id: t.targetId, type: t.type, title: t.title, url: t.url, webSocketDebuggerUrl: `pipe:${String(t.targetId)}` }));
      } else {
        return new Response(null, { status: 404 });
      }
      return new Response(JSON.stringify(body), { status: 200 });
    };
    class SessionOverPipe extends PipeSession {
      constructor(url: string | URL) {
        super(browser, String(url));
      }
    }
    return { fetch: fetchOverPipe as typeof fetch, WebSocket: SessionOverPipe as unknown as typeof WebSocket };
  }
}

/** One target's flattened session, shaped like the WebSocket the channel expects. */
export class PipeSession {
  #sessionId: string | undefined;
  #open = false;
  #ended = false;
  readonly #listeners = new Map<string, Set<{ fn: Listener; once: boolean }>>();

  constructor(private readonly browser: PipeBrowser, url: string) {
    const targetId = url.startsWith("pipe:") ? url.slice("pipe:".length) : url;
    void browser.call("Target.attachToTarget", { targetId, flatten: true }).then((reply) => {
      const sessionId = (reply.result as { sessionId?: string } | undefined)?.sessionId;
      if (this.#ended) {
        if (sessionId !== undefined) void browser.call("Target.detachFromTarget", { sessionId });
        return;
      }
      if (sessionId === undefined) {
        this.#emit("error", {});
        this.gone();
        return;
      }
      this.#sessionId = sessionId;
      this.#open = true;
      browser.register(sessionId, this);
      this.#emit("open", {});
    });
  }

  addEventListener(type: string, fn: Listener, options?: { once?: boolean }): void {
    const set = this.#listeners.get(type) ?? new Set();
    set.add({ fn, once: options?.once === true });
    this.#listeners.set(type, set);
  }

  removeEventListener(type: string, fn: Listener): void {
    const set = this.#listeners.get(type);
    if (set === undefined) return;
    for (const entry of set) if (entry.fn === fn) set.delete(entry);
  }

  #emit(type: string, event: { data?: string }): void {
    for (const entry of [...(this.#listeners.get(type) ?? [])]) {
      if (entry.once) this.#listeners.get(type)?.delete(entry);
      entry.fn(event);
    }
  }

  send(text: string): void {
    if (!this.#open || this.#sessionId === undefined) throw new Error("the session is not open");
    const message = JSON.parse(text) as Record<string, unknown>;
    if (!this.browser.write({ ...message, sessionId: this.#sessionId })) throw new Error("the browser's pipe closed");
  }

  deliver(data: string): void {
    this.#emit("message", { data });
  }

  close(): void {
    if (this.#sessionId !== undefined && this.#open) void this.browser.call("Target.detachFromTarget", { sessionId: this.#sessionId });
    this.gone();
  }

  gone(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#open = false;
    if (this.#sessionId !== undefined) this.browser.unregister(this.#sessionId);
    this.#emit("close", {});
  }
}

// The browser this daemon launched, when it launched one. Its pipe is the
// only route to it; a browser the operator started with a port is reached on
// that port instead (and can be reached around the daemon - see ADR-0119).
let launched: PipeBrowser | undefined;

export function adoptLaunchedBrowser(browser: PipeBrowser): void {
  launched = browser;
}

export function launchedBrowser(): PipeBrowser | undefined {
  return launched !== undefined && !launched.closed ? launched : undefined;
}

/** Seams that follow the daemon's own browser when there is one, and the port otherwise. */
export function followLaunchedBrowser(): Required<LiveCdpDeps> {
  const viaPort = { fetch, WebSocket };
  class Either {
    constructor(url: string | URL) {
      const pipe = launchedBrowser();
      return (pipe !== undefined && String(url).startsWith("pipe:") ? new (pipe.deps().WebSocket)(url) : new viaPort.WebSocket(url)) as unknown as Either;
    }
  }
  return {
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      const pipe = launchedBrowser();
      return pipe !== undefined ? pipe.deps().fetch(input, init) : viaPort.fetch(input, init);
    }) as typeof fetch,
    WebSocket: Either as unknown as typeof WebSocket,
  };
}

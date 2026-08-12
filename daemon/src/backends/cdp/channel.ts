import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type BackendChange,
  type ChannelWatch,
  replayWatch,
  type TapeEvent,
  WatchUnsupportedError,
} from "../../backend.js";
import { fixturesDir } from "../atspi/channel.js";
import { type CdpWatchAnchor, openSubtreeStream } from "./subtree-stream.js";

// The browser channel: every debugging-protocol exchange the CDP backend
// performs goes through exactly one exchange() seam, mirroring the posture of
// the D-Bus channel (daemon/src/backends/atspi/channel.ts) without borrowing
// its shape - CDP is not D-Bus-shaped. HTTP discovery (/json/version,
// /json/list) is ON the seam deliberately: replay must answer discovery
// without a browser, so discovery must be recordable. ADR-0035.

// Backend/infra policy, never wire vocabulary: the port the daemon's own
// launch recipe opens, and the port the fixture-page server listens on.
export const DEBUG_PORT = 9744;
export const PAGE_PORT = 9745;

export type CdpExchange =
  | { readonly kind: "version" }
  | { readonly kind: "list" }
  | { readonly kind: "call"; readonly targetId: string; readonly method: string; readonly params: unknown };

export interface CdpChannel {
  exchange(e: CdpExchange): Promise<unknown>;
  // The second direction on the same seam (ADR-0039). Protocol messages that
  // answer no request are exactly what an event is, and rpc() already saw
  // them - it discarded anything without a matching id; now they are routed.
  // The anchor is what the walk recorded about the watched node: the live
  // channel installs the observer on it, and a recorded channel ignores it
  // because a tape is keyed by the subscription, not by the page.
  watch(
    subscribedTo: string,
    sink: (change: BackendChange) => void,
    anchor: CdpWatchAnchor,
  ): Promise<ChannelWatch>;
  close(): Promise<void>;
}

// One stable key per exchange; the replay channel looks answers up by it.
// Fields are serialized in literal declaration order, and params is part of
// the key on purpose - the same lesson the D-Bus channel learned: a looser
// key produced a false "identical" replay.
export function exchangeKey(e: CdpExchange): string {
  switch (e.kind) {
    case "version":
      return JSON.stringify({ kind: "version" });
    case "list":
      return JSON.stringify({ kind: "list" });
    case "call":
      return JSON.stringify({ kind: "call", targetId: e.targetId, method: e.method, params: e.params ?? null });
  }
}

// Thrown when the debugging endpoint cannot be reached at all. Reachability
// is the caller's decision to interpret - unreachable is itself reportable
// (ADR-0022), never silently retried here.
export class CdpUnreachableError extends Error {}

// Thrown by the replay channel when asked for an exchange the tape never
// recorded. Defined locally rather than importing the D-Bus channel's
// UnrecordedExchangeError: the two transports must not be tied together by a
// shared error type. Refuse-on-ignorance, not invention.
export class UnrecordedCdpExchangeError extends Error {}

interface DiscoveredTarget {
  readonly id?: string;
  readonly webSocketDebuggerUrl?: string;
}

// Lazy: nothing dials until the first exchange, so constructing the backend
// (as the conformance suite does at collection time) is free.
export function liveCdpChannel(endpoint: string): CdpChannel {
  const sockets = new Map<string, Promise<WebSocket>>();
  let targets: DiscoveredTarget[] = [];
  let nextId = 1;
  // The event direction, per target. rpc() ignores messages that answer no
  // request; these listeners are what they are for (ADR-0039).
  const eventListeners = new Map<string, Set<(method: string, params: Record<string, unknown>) => void>>();

  async function http(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(endpoint + path);
    } catch {
      throw new CdpUnreachableError(`no debugging endpoint answered at ${endpoint}${path}`);
    }
    try {
      if (!response.ok) throw new Error();
      return await response.json();
    } catch {
      // A proxy page or an endpoint mid-shutdown is honestly "unreachable",
      // not a raw SyntaxError from the parse.
      throw new CdpUnreachableError(`the endpoint at ${endpoint}${path} did not answer usable JSON`);
    }
  }

  function socketFor(targetId: string): Promise<WebSocket> {
    const cached = sockets.get(targetId);
    if (cached) return cached;
    const target = targets.find((t) => t.id === targetId);
    const url = target?.webSocketDebuggerUrl;
    if (url === undefined) {
      return Promise.reject(
        new CdpUnreachableError(`no target "${targetId}" in the most recent list reply - list before call`),
      );
    }
    const opened = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(ws), { once: true });
      ws.addEventListener(
        "error",
        () => {
          sockets.delete(targetId);
          reject(new CdpUnreachableError(`the debugging socket for target "${targetId}" could not be opened`));
        },
        { once: true },
      );
      // A dead socket must not stay cached: the next exchange redials
      // instead of sending into a closed connection.
      ws.addEventListener("close", () => sockets.delete(targetId), { once: true });
      // Every message without an id is an event. One reader per socket fans
      // them out; a socket with no watches has an empty listener set and the
      // messages go nowhere, which is what discarding them was.
      ws.addEventListener("message", (event) => {
        const listeners = eventListeners.get(targetId);
        if (listeners === undefined || listeners.size === 0) return;
        let message: { id?: number; method?: string; params?: Record<string, unknown> };
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (message.id !== undefined || message.method === undefined) return;
        for (const listener of listeners) listener(message.method, message.params ?? {});
      });
    });
    sockets.set(targetId, opened);
    return opened;
  }

  function rpc(ws: WebSocket, method: string, params: unknown): Promise<unknown> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      // A hang is not a refusal (refuses-malformed-lines.test.ts:10-12): if
      // the socket dies before the reply arrives - tab closed, browser
      // crashed, terminateOwned mid-query - the pending call must reject, or
      // the server's serialised chain never advances again for any client.
      const onGone = () => {
        cleanup();
        reject(new CdpUnreachableError(`the debugging socket closed before "${method}" was answered`));
      };
      const onMessage = (event: MessageEvent) => {
        const message = JSON.parse(String(event.data)) as { id?: number };
        if (message.id !== id) return;
        cleanup();
        // The reply is stored minus the connection-local id, so tapes are
        // connection-independent: {result} or {error}, never {id, ...}.
        const { id: _connectionLocal, ...reply } = message;
        resolve(reply);
      };
      const cleanup = () => {
        ws.removeEventListener("message", onMessage);
        ws.removeEventListener("close", onGone);
        ws.removeEventListener("error", onGone);
      };
      ws.addEventListener("message", onMessage);
      ws.addEventListener("close", onGone);
      ws.addEventListener("error", onGone);
      ws.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  }

  return {
    async exchange(e) {
      switch (e.kind) {
        case "version":
          return http("/json/version");
        case "list": {
          const reply = await http("/json/list");
          if (Array.isArray(reply)) targets = reply as DiscoveredTarget[];
          return reply;
        }
        case "call":
          return rpc(await socketFor(e.targetId), e.method, e.params);
      }
    },
    async watch(subscribedTo, sink, anchor) {
      // The browser at the endpoint is the only application this route ever
      // reads, and its own application element is not a subtree of anything -
      // there is no node to anchor an observer on.
      if (anchor.backendDOMNodeId === undefined && anchor.nodeId === undefined) {
        throw new WatchUnsupportedError(
          "the browser's own application element names no node in a page - a watch needs a subtree to anchor on, and accepting one that could never report would be indistinguishable from a quiet page",
        );
      }
      const ws = await socketFor(anchor.targetId);
      return openSubtreeStream(
        {
          call: (method, params) => rpc(ws, method, params),
          onProtocolEvent: (listener) => {
            const listeners = eventListeners.get(anchor.targetId) ?? new Set();
            listeners.add(listener);
            eventListeners.set(anchor.targetId, listeners);
            return () => listeners.delete(listener);
          },
        },
        anchor,
        subscribedTo,
        sink,
      );
    },
    async close() {
      for (const pending of sockets.values()) {
        try {
          (await pending).close();
        } catch {
          // a socket that never opened has nothing to close
        }
      }
      sockets.clear();
      targets = [];
    },
  };
}

export interface CdpTapeEntry {
  readonly exchange: CdpExchange;
  readonly reply: unknown;
}

export function cdpTapePath(fixture: string): string {
  return join(fixturesDir(), fixture, "tape.json");
}

// The browser tape. Same two directions as the D-Bus tape, its own shape:
// exchanges are CDP-shaped, and the recorded events are seam vocabulary.
export interface CdpTape {
  exchanges: CdpTapeEntry[];
  events: TapeEvent[];
}

// Tapes recorded before the channel had a second direction are a bare array of
// exchanges. They are read as what they are - a recording with no events - and
// never rewritten: a tape is what the world did, not what we would like it to
// have done.
export function asCdpTape(recorded: unknown): CdpTape {
  if (Array.isArray(recorded)) return { exchanges: recorded as CdpTapeEntry[], events: [] };
  const tape = recorded as Partial<CdpTape>;
  return { exchanges: tape.exchanges ?? [], events: tape.events ?? [] };
}

export function loadCdpTape(fixture: string): CdpTape {
  const file = cdpTapePath(fixture);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`replay: no tape at ${file} - fixtures are captured with --capture, never hand-authored`);
  }
  return asCdpTape(JSON.parse(text));
}

export function captureCdpChannel(inner: CdpChannel, captureName: string): CdpChannel {
  const exchanges: CdpTapeEntry[] = [];
  const events: TapeEvent[] = [];
  return {
    async exchange(e) {
      const reply = await inner.exchange(e);
      exchanges.push({ exchange: e, reply });
      return reply;
    },
    async watch(subscribedTo, sink, anchor) {
      // Changes are recorded as they arrive, on the way through to the caller:
      // a capture of a watch is a recording of what the page said, in the
      // order it said it.
      const began = Date.now();
      return inner.watch(
        subscribedTo,
        (change) => {
          events.push({ afterMs: Date.now() - began, subscribedTo, change });
          sink(change);
        },
        anchor,
      );
    },
    async close() {
      const dir = join(fixturesDir(), captureName);
      mkdirSync(dir, { recursive: true });
      const tape: CdpTape = { exchanges, events };
      writeFileSync(join(dir, "tape.json"), `${JSON.stringify(tape, null, 1)}\n`);
      console.log(
        `capture: ${exchanges.length} exchange(s) and ${events.length} event(s) recorded to daemon/fixtures/${captureName}/tape.json`,
      );
      await inner.close();
    },
  };
}

export function replayCdpChannel(fixture: string): CdpChannel {
  let table: Map<string, unknown> | null = null;
  return {
    async exchange(e) {
      if (table === null) {
        table = new Map(loadCdpTape(fixture).exchanges.map((entry) => [exchangeKey(entry.exchange), entry.reply]));
      }
      const key = exchangeKey(e);
      if (!table.has(key)) {
        throw new UnrecordedCdpExchangeError(`no recorded exchange for ${key} - refusing to invent a reply`);
      }
      return table.get(key);
    },
    async watch(subscribedTo, sink) {
      // A tape that recorded no events answers a watch normally and says
      // nothing. That is a valid recording of a quiet page, not an error. The
      // anchor is not consulted: what the page did is on the tape, and a
      // recording is not re-derived from the page it was recorded from.
      return replayWatch(loadCdpTape(fixture).events, subscribedTo, sink);
    },
    async close() {
      // no browser was ever contacted; nothing to release
    },
  };
}

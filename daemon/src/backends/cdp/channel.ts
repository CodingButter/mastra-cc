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

// The one deadline every wait on the browser shares. Internal policy, never
// wire vocabulary, never configurable: a stage that has not settled by now is
// reported, not waited on, because the daemon's request chain is serialised
// and one silent browser must not hold every other client.
export const CDP_CALL_DEADLINE_MS = 10_000;

// Thrown when the browser did not answer within CDP_CALL_DEADLINE_MS.
// effectSent says whether the request left this process: an unsent call
// changed nothing, a sent one has an unknown outcome.
export class CdpDeadlineError extends Error {
  readonly method: string;
  readonly effectSent: boolean;
  constructor(details: { method: string; effectSent: boolean }) {
    super(`the browser did not answer "${details.method}" within ${CDP_CALL_DEADLINE_MS / 1000}s`);
    this.method = details.method;
    this.effectSent = details.effectSent;
  }
}

// Attaching is bounded tighter than a call. A page already holding a dialog
// when the daemon attaches never answers Page.enable and never reports the
// dialog (measured on Chrome 151: nothing in 13s), so the attach itself is the
// only signal - and a person waiting on the desk should hear it in under 2s.
export const CDP_INIT_DEADLINE_MS = 1_500;

// Thrown while a native dialog (alert/confirm/prompt/beforeunload) holds the
// page: every call on that target is frozen until a person answers it. The
// daemon never answers it for them.
export class DialogBlockingError extends Error {
  readonly type: string;
  readonly dialogMessage: string;
  readonly method: string;
  readonly effectSent: boolean;
  constructor(details: { type: string; message: string; method: string; effectSent: boolean }) {
    super(`the page is showing a ${details.type} dialog`);
    this.type = details.type;
    this.dialogMessage = details.message;
    this.method = details.method;
    this.effectSent = details.effectSent;
  }
}

// Thrown by the replay channel when asked for an exchange the tape never
// recorded. Defined locally rather than importing the D-Bus channel's
// UnrecordedExchangeError: the two transports must not be tied together by a
// shared error type. Refuse-on-ignorance, not invention.
export class UnrecordedCdpExchangeError extends Error {}

interface DiscoveredTarget {
  readonly id?: string;
  readonly webSocketDebuggerUrl?: string;
}

interface PendingCall {
  readonly method: string;
  sent: boolean;
  timer: ReturnType<typeof setTimeout>;
  resolve(reply: unknown): void;
  reject(error: Error): void;
}

interface SocketState {
  readonly ws: WebSocket;
  readonly pending: Map<number, PendingCall>;
  dialog: { open: boolean; type: string; message: string };
  ready: Promise<void>;
  // Set when initialisation was stopped by a dialog: the close re-arms it.
  initBlocked: boolean;
  mainFrameId?: string;
}

export interface LiveCdpDeps {
  readonly WebSocket?: typeof WebSocket;
  readonly fetch?: typeof fetch;
}

// Lazy: nothing dials until the first exchange, so constructing the backend
// (as the conformance suite does at collection time) is free.
// pendingCalls() is diagnostic, not seam: the count of calls still waiting on
// any socket, so a test can prove a settled call left nothing behind.
export function liveCdpChannel(endpoint: string, deps: LiveCdpDeps = {}): CdpChannel & { pendingCalls(): number } {
  const states: SocketState[] = [];
  const WebSocketImpl = deps.WebSocket ?? WebSocket;
  const fetchImpl = deps.fetch ?? fetch;
  const sockets = new Map<string, Promise<SocketState>>();
  let targets: DiscoveredTarget[] = [];
  let nextId = 1;
  // The event direction, per target (ADR-0039).
  const eventListeners = new Map<string, Set<(method: string, params: Record<string, unknown>) => void>>();

  async function http(path: string): Promise<unknown> {
    // One signal bounds both the request and the body read.
    // A plain timer rather than AbortSignal.timeout, so the deadline is one
    // clock the tests can drive.
    const controller = new AbortController();
    const signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), CDP_CALL_DEADLINE_MS);
    try {
      let response: Response;
      try {
        response = await fetchImpl(endpoint + path, { signal });
      } catch {
        if (signal.aborted) throw new CdpDeadlineError({ method: "discovery", effectSent: false });
        throw new CdpUnreachableError(`no debugging endpoint answered at ${endpoint}${path}`);
      }
      try {
        if (!response.ok) throw new Error();
        return await response.json();
      } catch {
        if (signal.aborted) throw new CdpDeadlineError({ method: "discovery", effectSent: false });
        // A proxy page or an endpoint mid-shutdown is honestly "unreachable",
        // not a raw SyntaxError from the parse.
        throw new CdpUnreachableError(`the endpoint at ${endpoint}${path} did not answer usable JSON`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  function failAll(state: SocketState, error: (call: PendingCall) => Error): void {
    for (const [id, call] of state.pending) {
      clearTimeout(call.timer);
      state.pending.delete(id);
      call.reject(error(call));
    }
  }

  // The readiness gate: Page.enable (so dialogs are heard) then the frame
  // tree, both under the attach deadline and neither waiting on ready itself.
  // A dialog during init keeps the socket - its close event re-arms the gate;
  // anything else drops the socket so the next call attaches afresh.
  function arm(state: SocketState, drop: () => void): void {
    state.initBlocked = false;
    state.ready = (async () => {
      try {
        await raw(state, "Page.enable", {}, CDP_INIT_DEADLINE_MS);
        const tree = (await raw(state, "Page.getFrameTree", {}, CDP_INIT_DEADLINE_MS)) as {
          result?: { frameTree?: { frame?: { id?: string } } };
        };
        state.mainFrameId = tree.result?.frameTree?.frame?.id;
      } catch (error) {
        if (error instanceof DialogBlockingError) {
          state.initBlocked = true;
          throw new DialogBlockingError({ type: error.type, message: error.dialogMessage, method: error.method, effectSent: false });
        }
        drop();
        if (error instanceof CdpDeadlineError) throw new CdpDeadlineError({ method: error.method, effectSent: false });
        throw error;
      }
    })();
    // Every caller awaits ready and receives its rejection; nobody owns it
    // when no call is queued.
    state.ready.catch(() => undefined);
  }

  function socketFor(targetId: string): Promise<SocketState> {
    const cached = sockets.get(targetId);
    if (cached) return cached;
    const target = targets.find((t) => t.id === targetId);
    const url = target?.webSocketDebuggerUrl;
    if (url === undefined) {
      return Promise.reject(
        new CdpUnreachableError(`no target "${targetId}" in the most recent list reply - list before call`),
      );
    }
    const opened = new Promise<SocketState>((resolve, reject) => {
      const ws = new WebSocketImpl(url);
      const state: SocketState = {
        ws,
        pending: new Map(),
        dialog: { open: false, type: "", message: "" },
        ready: Promise.resolve(),
        initBlocked: false,
      };
      states.push(state);
      let isOpen = false;
      const evict = () => {
        if (sockets.get(targetId) === opened) sockets.delete(targetId);
      };
      const openTimer = setTimeout(() => {
        evict();
        reject(new CdpDeadlineError({ method: "open", effectSent: false }));
        try {
          ws.close();
        } catch {
          // closing a socket that never opened is best-effort
        }
      }, CDP_CALL_DEADLINE_MS);
      ws.addEventListener(
        "open",
        () => {
          clearTimeout(openTimer);
          isOpen = true;
          arm(state, () => {
            evict();
            try {
              ws.close();
            } catch {
              // best-effort
            }
          });
          resolve(state);
        },
        { once: true },
      );
      // A hang is not a refusal (refuses-malformed-lines.test.ts:10-12): a
      // dying socket rejects everything still waiting on it, and a dead
      // socket must not stay cached.
      const gone = () => {
        clearTimeout(openTimer);
        evict();
        if (!isOpen) {
          reject(new CdpUnreachableError(`the debugging socket for target "${targetId}" could not be opened`));
        }
        failAll(state, () => new CdpUnreachableError(`the debugging socket for target "${targetId}" closed before its call was answered`));
      };
      ws.addEventListener("error", gone);
      ws.addEventListener("close", gone);
      // The one reader per socket: replies settle their pending call, every
      // message without an id is an event.
      ws.addEventListener("message", (event) => {
        let message: { id?: number; method?: string; params?: Record<string, unknown> };
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (message.id !== undefined) {
          const call = state.pending.get(message.id);
          // A late reply (its call already timed out) or a foreign id.
          if (call === undefined) return;
          clearTimeout(call.timer);
          state.pending.delete(message.id);
          // The reply is stored minus the connection-local id, so tapes are
          // connection-independent: {result} or {error}, never {id, ...}.
          const { id: _connectionLocal, ...reply } = message;
          call.resolve(reply);
          return;
        }
        if (message.method === undefined) return;
        // Heard centrally, watched or not: a dialog freezes the whole target.
        if (message.method === "Page.javascriptDialogOpening") {
          const params = message.params ?? {};
          state.dialog = { open: true, type: String(params.type ?? "alert"), message: String(params.message ?? "") };
          failAll(state, (call) => new DialogBlockingError({ ...state.dialog, method: call.method, effectSent: call.sent }));
        } else if (message.method === "Page.javascriptDialogClosed") {
          state.dialog = { open: false, type: "", message: "" };
          if (state.initBlocked) arm(state, () => evict());
        }
        const listeners = eventListeners.get(targetId);
        if (listeners === undefined) return;
        for (const listener of listeners) listener(message.method, message.params ?? {});
      });
    });
    sockets.set(targetId, opened);
    return opened;
  }

  // The single send path: every exchange and every watch call goes through
  // here, so all of them share the deadline.
  async function send(state: SocketState, method: string, params: unknown): Promise<unknown> {
    await state.ready;
    if (state.dialog.open) {
      throw new DialogBlockingError({ ...state.dialog, method, effectSent: false });
    }
    return raw(state, method, params, CDP_CALL_DEADLINE_MS);
  }

  function raw(state: SocketState, method: string, params: unknown, deadline: number): Promise<unknown> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const call: PendingCall = {
        method,
        sent: false,
        timer: setTimeout(() => {
          state.pending.delete(id);
          reject(new CdpDeadlineError({ method, effectSent: call.sent }));
        }, deadline),
        resolve,
        reject,
      };
      state.pending.set(id, call);
      try {
        state.ws.send(JSON.stringify({ id, method, params: params ?? {} }));
      } catch {
        clearTimeout(call.timer);
        state.pending.delete(id);
        reject(new CdpUnreachableError(`the debugging socket could not carry "${method}"`));
        return;
      }
      call.sent = true;
    });
  }

  return {
    pendingCalls: () => states.reduce((n, state) => n + state.pending.size, 0),
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
          return send(await socketFor(e.targetId), e.method, e.params);
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
      const state = await socketFor(anchor.targetId);
      return openSubtreeStream(
        {
          call: (method, params) => send(state, method, params),
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
          (await pending).ws.close();
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

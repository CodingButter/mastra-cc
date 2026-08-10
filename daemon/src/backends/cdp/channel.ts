import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixturesDir } from "../atspi/channel.js";

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

  async function http(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(endpoint + path);
    } catch {
      throw new CdpUnreachableError(`no debugging endpoint answered at ${endpoint}${path}`);
    }
    return response.json();
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
    });
    sockets.set(targetId, opened);
    return opened;
  }

  function rpc(ws: WebSocket, method: string, params: unknown): Promise<unknown> {
    const id = nextId++;
    return new Promise((resolve) => {
      const onMessage = (event: MessageEvent) => {
        const message = JSON.parse(String(event.data)) as { id?: number };
        if (message.id !== id) return;
        ws.removeEventListener("message", onMessage);
        // The reply is stored minus the connection-local id, so tapes are
        // connection-independent: {result} or {error}, never {id, ...}.
        const { id: _connectionLocal, ...reply } = message;
        resolve(reply);
      };
      ws.addEventListener("message", onMessage);
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

export function loadCdpTape(fixture: string): CdpTapeEntry[] {
  const file = cdpTapePath(fixture);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`replay: no tape at ${file} - fixtures are captured with --capture, never hand-authored`);
  }
  return JSON.parse(text) as CdpTapeEntry[];
}

export function captureCdpChannel(inner: CdpChannel, captureName: string): CdpChannel {
  const tape: CdpTapeEntry[] = [];
  return {
    async exchange(e) {
      const reply = await inner.exchange(e);
      tape.push({ exchange: e, reply });
      return reply;
    },
    async close() {
      const dir = join(fixturesDir(), captureName);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "tape.json"), `${JSON.stringify(tape, null, 1)}\n`);
      console.log(`capture: ${tape.length} exchange(s) recorded to daemon/fixtures/${captureName}/tape.json`);
      await inner.close();
    },
  };
}

export function replayCdpChannel(fixture: string): CdpChannel {
  let table: Map<string, unknown> | null = null;
  return {
    async exchange(e) {
      if (table === null) table = new Map(loadCdpTape(fixture).map((entry) => [exchangeKey(entry.exchange), entry.reply]));
      const key = exchangeKey(e);
      if (!table.has(key)) {
        throw new UnrecordedCdpExchangeError(`no recorded exchange for ${key} - refusing to invent a reply`);
      }
      return table.get(key);
    },
    async close() {
      // no browser was ever contacted; nothing to release
    },
  };
}

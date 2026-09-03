import { mkdtempSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import { connect, isTransportConnectionError } from "../index.js";

interface Peer {
  server: Server;
  socketPath: string;
  sockets: Set<Socket>;
  requests: string[];
}

async function peer(onRequest?: (message: { id: number; method: string }, socket: Socket) => void): Promise<Peer> {
  const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-terminal-")), "daemon.sock");
  const sockets = new Set<Socket>();
  const requests: string[] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        const message = JSON.parse(line) as { type: string; id: number; method: string };
        if (message.type === "hello") socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
        if (message.type === "request") {
          requests.push(line);
          onRequest?.(message, socket);
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return { server, socketPath, sockets, requests };
}

const peers: Peer[] = [];
const nativeWebSocket = globalThis.WebSocket;
afterEach(async () => {
  globalThis.WebSocket = nativeWebSocket;
  for (const item of peers.splice(0)) {
    for (const socket of item.sockets) socket.destroy();
    await new Promise<void>((resolve) => item.server.close(() => resolve()));
  }
});

class ThrowingWebSocket {
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  writes = 0;

  constructor(readonly failAt: number) {
    queueMicrotask(() => this.emit("open", {}));
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(line: string): void {
    this.writes += 1;
    if (this.writes === this.failAt) throw new Error(`write ${this.writes} failed`);
    const message = JSON.parse(line) as { type: string };
    if (message.type === "hello") {
      queueMicrotask(() => this.emit("message", { data: `${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n` }));
    }
  }

  close(): void {
    this.emit("close", {});
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function throwingWebSocket(failAt: number): ThrowingWebSocket[] {
  const instances: ThrowingWebSocket[] = [];
  globalThis.WebSocket = class extends ThrowingWebSocket {
    constructor() {
      super(failAt);
      instances.push(this);
    }
  } as unknown as typeof WebSocket;
  return instances;
}

describe("terminal transport state", () => {
  it("rejects pending and later calls with the same terminal error without another write", async () => {
    const daemon = await peer();
    peers.push(daemon);
    const client = await connect({ socketPath: daemon.socketPath });
    const pending = client.queryElements({});
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (const socket of daemon.sockets) socket.destroy();

    const first = await pending.catch((error: unknown) => error);
    const writesAtClose = daemon.requests.length;
    const second = await client.queryElements({}).catch((error: unknown) => error);
    const third = await client.listApplications().catch((error: unknown) => error);

    expect(isTransportConnectionError(first)).toBe(true);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(first).toMatchObject({
      name: "TransportConnectionError",
      code: "MASTRA_CC_TRANSPORT_TERMINAL",
      message: `transport: connection to ${daemon.socketPath} closed`,
    });
    expect(daemon.requests).toHaveLength(writesAtClose);
  });

  it("makes an explicit close terminal", async () => {
    const daemon = await peer();
    peers.push(daemon);
    const client = await connect({ socketPath: daemon.socketPath });

    client.close();
    const error = await client.queryElements({}).catch((value: unknown) => value);

    expect(isTransportConnectionError(error)).toBe(true);
    expect(error).toMatchObject({ code: "MASTRA_CC_TRANSPORT_TERMINAL" });
    expect(daemon.requests).toHaveLength(0);
  });

  it("keeps a response refusal non-terminal", async () => {
    const daemon = await peer((message, socket) => {
      socket.write(`${JSON.stringify({ type: "response", id: message.id, refusal: "nope" })}\n`);
    });
    peers.push(daemon);
    const client = await connect({ socketPath: daemon.socketPath });

    await expect(client.queryElements({})).rejects.toThrow("nope");
    await expect(client.queryElements({})).rejects.toThrow("nope");

    expect(daemon.requests).toHaveLength(2);
    client.close();
  });

  it("classifies a failed initial dial", async () => {
    const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-no-peer-")), "missing.sock");
    const error = await connect({ socketPath }).catch((value: unknown) => value);

    expect(isTransportConnectionError(error)).toBe(true);
    expect(error).toMatchObject({
      name: "TransportConnectionError",
      code: "MASTRA_CC_TRANSPORT_TERMINAL",
    });
    expect((error as Error).cause).toBeInstanceOf(Error);
  });

  it("classifies a synchronous handshake write failure", async () => {
    throwingWebSocket(1);

    const error = await connect({ url: "ws://proof.invalid" }).catch((value: unknown) => value);

    expect(isTransportConnectionError(error)).toBe(true);
    expect(error).toMatchObject({ message: "write 1 failed", code: "MASTRA_CC_TRANSPORT_TERMINAL" });
    expect((error as Error).cause).toMatchObject({ message: "write 1 failed" });
  });

  it("makes a synchronous request write failure terminal before another call can write", async () => {
    const sockets = throwingWebSocket(2);
    const client = await connect({ url: "ws://proof.invalid" });

    const first = await client.queryElements({}).catch((value: unknown) => value);
    const second = await client.listApplications().catch((value: unknown) => value);

    expect(isTransportConnectionError(first)).toBe(true);
    expect(second).toBe(first);
    expect(first).toMatchObject({ message: "write 2 failed", code: "MASTRA_CC_TRANSPORT_TERMINAL" });
    expect(sockets[0]?.writes).toBe(2);
  });
});

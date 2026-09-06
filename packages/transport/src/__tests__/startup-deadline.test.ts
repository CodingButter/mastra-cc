import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import WebSocket from "ws";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import { connect, TransportConnectionError } from "../index.js";

vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return { ...actual, createConnection: vi.fn(actual.createConnection) };
});

vi.mock("ws", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ws")>();
  return { ...actual, default: vi.fn(function (url: string) { return new actual.default(url); }) };
});

const hello = `${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`;

class SocketPeer extends EventEmitter {
  writes: string[] = [];
  destroyed = false;
  write(line: string): boolean {
    this.writes.push(line);
    return true;
  }
  destroy(): this {
    this.destroyed = true;
    this.emit("close");
    return this;
  }
  end(): void {
    this.destroy();
  }
}

class WebSocketPeer extends EventTarget {
  writes: string[] = [];
  closed = false;
  terminated = false;
  terminate(): void {
    this.terminated = true;
    this.dispatchEvent(new Event("close"));
  }
  send(line: string): void {
    this.writes.push(line);
  }
  close(): void {
    this.closed = true;
    this.dispatchEvent(new Event("close"));
  }
}

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(createConnection).mockReset();
  vi.mocked(WebSocket).mockReset();
});

function dial(kind: "socket" | "websocket") {
  const socket = new SocketPeer();
  const websocket = new WebSocketPeer();
  if (kind === "socket") vi.mocked(createConnection).mockReturnValueOnce(socket as unknown as Socket);
  vi.mocked(WebSocket).mockImplementationOnce(function () {
    return websocket as unknown as WebSocket;
  });
  const promise = connect(kind === "socket" ? { socketPath: "/startup-proof.sock" } : { url: "ws://proof.invalid" });
  // Observe rejection immediately, including when fake time fires before an assertion.
  const outcome = promise.catch((error: unknown) => error);
  return {
    promise,
    outcome,
    writes: kind === "socket" ? socket.writes : websocket.writes,
    dropped: () => kind === "socket" ? socket.destroyed : websocket.terminated,
    gracefullyClosed: () => websocket.closed,
    open: () => kind === "socket" ? socket.emit("connect") : websocket.dispatchEvent(new Event("open")),
    close: () => kind === "socket" ? socket.emit("close") : websocket.dispatchEvent(new Event("close")),
    error: () => kind === "socket" ? socket.emit("error", new Error("opening failed")) : websocket.dispatchEvent(new Event("error")),
    data: (line: string) => kind === "socket" ? socket.emit("data", Buffer.from(line)) : websocket.dispatchEvent(new MessageEvent("message", { data: line })),
  };
}

it("destroys a real socket whose peer accepts but never answers hello", async () => {
  const directory = await mkdtemp(join(tmpdir(), "transport-startup-"));
  const socketPath = join(directory, "daemon.sock");
  const server = createServer();
  let accepted: Socket | undefined;
  try {
    server.listen(socketPath);
    await once(server, "listening");
    const connection = once(server, "connection");
    const outcome = connect({ socketPath }).catch((error: unknown) => error);
    [accepted] = await connection as [Socket];
    const closed = once(accepted, "close");
    await once(accepted, "data");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await outcome).toBeInstanceOf(TransportConnectionError);
    await closed;
    expect(accepted.destroyed).toBe(true);
  } finally {
    accepted?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

it("hard-terminates startup but gracefully closes an established websocket", async () => {
  const failed = dial("websocket");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await failed.outcome).toBeInstanceOf(TransportConnectionError);
  expect(failed.dropped()).toBe(true);
  expect(failed.gracefullyClosed()).toBe(false);
  const healthy = dial("websocket");
  healthy.open();
  healthy.data(hello);
  const client = await healthy.promise;
  client.close();
  expect(healthy.gracefullyClosed()).toBe(true);
  expect(healthy.dropped()).toBe(false);
});

it.each([2_000, 12_000])("charges %i ms of websocket construction to the startup budget", async (delay) => {
  const websocket = new WebSocketPeer();
  const start = performance.now();
  vi.mocked(WebSocket).mockImplementationOnce(function () {
    vi.spyOn(performance, "now").mockReturnValue(start + delay);
    vi.setSystemTime(Date.now() - 60_000);
    return websocket as unknown as WebSocket;
  });
  const outcome = connect({ url: "ws://proof.invalid" }).catch((error: unknown) => error);
  const remaining = Math.max(0, 10_000 - delay);
  if (remaining > 0) {
    await vi.advanceTimersByTimeAsync(remaining - 1);
    expect(websocket.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
  } else await vi.advanceTimersByTimeAsync(0);
  expect(await outcome).toMatchObject({ message: expect.stringContaining("timed out after 10000ms") });
  expect(websocket.terminated).toBe(true);
  expect(websocket.closed).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("disconnects an upgraded websocket peer that never answers hello or a close frame", async () => {
  const server = createHttpServer();
  let accepted: import("node:stream").Duplex | undefined;
  const upgraded = new Promise<import("node:stream").Duplex>((resolve) => {
    server.on("upgrade", (request, socket) => {
      accepted = socket;
      const accept = createHash("sha1")
        .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      resolve(socket);
    });
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing TCP address");
    const outcome = connect({ url: `ws://127.0.0.1:${address.port}` }).catch((error: unknown) => error);
    const socket = await upgraded;
    const ended = once(socket, "end");
    await once(socket, "data");
    socket.resume();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await outcome).toBeInstanceOf(TransportConnectionError);
    await ended;
    expect(socket.readableEnded).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    accepted?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe.each(["socket", "websocket"] as const)("%s startup deadline", (kind) => {
  it("bounds a dial that never opens and ignores late open and hello", async () => {
    const peer = dial(kind);
    let settled = false;
    void peer.outcome.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    expect(peer.writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    const error = await peer.outcome;
    expect(error).toBeInstanceOf(TransportConnectionError);
    expect(error).toMatchObject({ message: expect.stringContaining("timed out after 10000ms") });
    expect(peer.dropped()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    peer.open();
    peer.data(hello);
    expect(await peer.outcome).toBe(error);
    expect(peer.writes).toEqual([]);
  });

  it("bounds hello silence and ignores a late handshake", async () => {
    const peer = dial(kind);
    peer.open();
    expect(peer.writes).toEqual([hello]);
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await peer.outcome;
    expect(error).toBeInstanceOf(TransportConnectionError);
    expect(peer.dropped()).toBe(true);
    peer.data(hello);
    expect(await peer.outcome).toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not reset the budget when the wire opens", async () => {
    const peer = dial(kind);
    await vi.advanceTimersByTimeAsync(8_000);
    peer.open();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(peer.dropped()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await peer.outcome).toBeInstanceOf(TransportConnectionError);
    expect(peer.dropped()).toBe(true);
  });

  it.each([-60_000, 60_000])("accepts an on-time hello after a wall-clock adjustment of %i ms", async (adjustment) => {
    const peer = dial(kind);
    peer.open();
    await vi.advanceTimersByTimeAsync(9_999);
    vi.setSystemTime(Date.now() + adjustment);
    peer.data(hello);
    const client = await peer.promise;
    expect(peer.dropped()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    client.close();
  });

  it.each([-60_000, 60_000])("keeps the timeout budget after a wall-clock adjustment of %i ms", async (adjustment) => {
    const peer = dial(kind);
    await vi.advanceTimersByTimeAsync(9_999);
    vi.setSystemTime(Date.now() + adjustment);
    expect(peer.dropped()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await peer.outcome).toMatchObject({ message: expect.stringContaining("timed out after 10000ms") });
    expect(peer.dropped()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([-60_000, 0, 60_000])("rejects an overdue hello before the timeout callback, with wall-clock adjustment %i ms", async (adjustment) => {
    const start = performance.now();
    const peer = dial(kind);
    peer.open();
    vi.setSystemTime(Date.now() + adjustment);
    vi.spyOn(performance, "now").mockReturnValue(start + 10_000);
    expect(vi.getTimerCount()).toBe(1);
    peer.data(hello);
    expect(await peer.outcome).toMatchObject({ message: expect.stringContaining("timed out after 10000ms") });
    expect(peer.dropped()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["close", "refusal"])("rejects synchronous hello followed by %s before startup resumes", async (failure) => {
    const peer = dial(kind);
    peer.open();
    peer.data(hello);
    if (failure === "close") peer.close();
    else peer.data('{"type":"refusal","refusal":"nope"}\n');
    const error = await peer.outcome;
    expect(error).toBeInstanceOf(TransportConnectionError);
    expect(error).toMatchObject({ message: expect.stringContaining(failure === "close" ? "closed" : "nope") });
    expect(peer.dropped()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    peer.data(hello);
    expect(await peer.outcome).toBe(error);
  });

  it("rejects hello and refusal in the same chunk", async () => {
    const peer = dial(kind);
    peer.open();
    peer.data(`${hello}{"type":"refusal","refusal":"nope"}\n`);
    expect(await peer.outcome).toMatchObject({ message: "nope" });
    expect(peer.dropped()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves established malformed-data teardown", async () => {
    const peer = dial(kind);
    peer.open();
    peer.data(hello);
    const client = await peer.promise;
    peer.data('not json\n');
    await expect(client.listApplications()).rejects.toBeInstanceOf(TransportConnectionError);
    expect(peer.dropped()).toBe(kind === "socket");
    if (kind === "websocket") expect(peer.gracefullyClosed()).toBe(true);
  });

  it("preserves established event delivery after refusal", async () => {
    const peer = dial(kind);
    peer.open();
    peer.data(hello);
    const client = await peer.promise;
    const listener = vi.fn();
    client.onChangeEvent(listener);
    const event = { subscriptionId: "proof", kind: "changed" };
    const frame = `${JSON.stringify({ type: "event", event })}\n`;
    peer.data(`{"type":"refusal","refusal":"nope"}\n${frame}`);
    peer.data(frame);
    expect(listener.mock.calls).toEqual([[event], [event]]);
    expect(peer.dropped()).toBe(false);
    await expect(client.listApplications()).rejects.toMatchObject({ message: "nope" });
    client.close();
  });

  it("rejects and cleans up a close before open", async () => {
    const peer = dial(kind);
    peer.close();
    expect(await peer.outcome).toBeInstanceOf(TransportConnectionError);
    expect(peer.dropped()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    peer.open();
    expect(peer.writes).toEqual([]);
  });

  it("cleans up an opening error", async () => {
    const peer = dial(kind);
    peer.error();
    expect(await peer.outcome).toBeInstanceOf(TransportConnectionError);
    expect(peer.dropped()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["refusal", "digest", "invalid JSON"])("cleans up a handshake failure: %s", async (failure) => {
    const peer = dial(kind);
    peer.open();
    peer.data(failure === "refusal" ? '{"type":"refusal","refusal":"nope"}\n' : failure === "digest" ? '{"type":"hello","digest":"wrong"}\n' : 'not json\n');
    expect(await peer.outcome).toBeInstanceOf(TransportConnectionError);
    expect(peer.dropped()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves healthy connections and pending requests usable beyond startup", async () => {
    const peer = dial(kind);
    peer.open();
    peer.data(hello);
    const client = await peer.promise;
    expect(vi.getTimerCount()).toBe(0);
    const pending = client.listApplications();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(peer.dropped()).toBe(false);
    peer.data('{"type":"response","id":1,"result":{"applications":[]}}\n');
    await expect(pending).resolves.toEqual({ applications: [] });
    const later = client.listApplications();
    peer.data('{"type":"response","id":2,"result":{"applications":[]}}\n');
    await expect(later).resolves.toEqual({ applications: [] });
    client.close();
  });

  it("permits a fresh explicit connection after failure without replay", async () => {
    const failed = dial(kind);
    failed.open();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await failed.outcome).toBeInstanceOf(TransportConnectionError);
    const fresh = dial(kind);
    fresh.open();
    fresh.data(hello);
    const client = await fresh.promise;
    expect(fresh.writes).toEqual([hello]);
    expect(failed.writes).toEqual([hello]);
    expect(vi.getTimerCount()).toBe(0);
    client.close();
  });
});

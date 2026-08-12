import { mkdtempSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SCHEMA_DIGEST, validateChangeEvent, type ChangeEvent } from "@mastra-cc/protocol-types";
import { connect } from "../index.js";

// The push direction, tested from the transport's side against a mock server
// that can be told exactly when to speak unprompted (ADR-0039). The mock lives
// inside packages/transport because B5 forbids socket code anywhere else.
//
// The property under test is the one that makes a server-initiated message
// safe to add to a request/response wire at all: an event carries no `id`, so
// it must never reach the pending-promise table, and a reply must still find
// its promise while listeners are attached.

const WATCHED: ChangeEvent = {
  subscriptionId: "sub-1",
  id: "el-0123456789ab",
  role: "textbox",
  kind: "changed",
  attribution: "external",
  priority: "high",
  at: 1_754_000_000_000,
};

function mockServer(onLine: (socket: Socket, line: string) => void): { server: Server; socketPath: string } {
  const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-events-")), "mock.sock");
  const server = createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (line.trim()) onLine(socket, line);
      }
    });
  });
  return { server, socketPath };
}

// Answers the handshake, then does whatever the test asked for each request.
function handshakingServer(onRequest: (socket: Socket, id: number, method: string) => void) {
  return mockServer((socket, line) => {
    const message = JSON.parse(line) as { type: string; id?: number; method?: string };
    if (message.type === "hello") {
      socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
    } else if (message.type === "request") {
      onRequest(socket, message.id as number, message.method as string);
    }
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// Several tests need the mock to speak, and a request is the only way to make
// it. Those requests are deliberately never answered, so the promise is
// rejected when the connection closes - which is correct behaviour, not a test
// failure, and is asserted directly in the socket-death test below.
function poke(client: { queryElements(params: Record<string, never>): Promise<unknown> }): void {
  client.queryElements({}).catch(() => undefined);
}

describe("the daemon can speak without being asked, and the transport keeps the two directions apart", () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  it("routes an id-less event line to a registered listener", async () => {
    const mock = handshakingServer((socket) => {
      socket.write(`${JSON.stringify({ type: "event", event: WATCHED })}\n`);
    });
    server = mock.server;
    await new Promise<void>((resolve) => mock.server.listen(mock.socketPath, resolve));

    const client = await connect({ socketPath: mock.socketPath });
    const seen: ChangeEvent[] = [];
    client.onChangeEvent((event) => seen.push(event));

    // Any request will do; the mock answers it with an event instead of a reply.
    poke(client);
    await settle();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(WATCHED);
    // The event the listener received is a conforming changeEvent, not a bag
    // of fields that happened to arrive.
    expect(validateChangeEvent(seen[0])).toEqual([]);
    client.close();
  });

  it("does not resolve or reject a pending request when an event arrives first", async () => {
    const mock = handshakingServer((socket, id) => {
      socket.write(`${JSON.stringify({ type: "event", event: WATCHED })}\n`);
      socket.write(`${JSON.stringify({ type: "response", id, result: { elements: [] } })}\n`);
    });
    server = mock.server;
    await new Promise<void>((resolve) => mock.server.listen(mock.socketPath, resolve));

    const client = await connect({ socketPath: mock.socketPath });
    const seen: ChangeEvent[] = [];
    client.onChangeEvent((event) => seen.push(event));

    // If the event had been treated as a reply, this would resolve with the
    // event's payload or hang forever. It must resolve with the real answer.
    await expect(client.queryElements({})).resolves.toEqual({ elements: [] });
    expect(seen).toEqual([WATCHED]);
    client.close();
  });

  it("delivers an event for a subscription the caller never asked about, rather than dropping protocol traffic", async () => {
    const foreign: ChangeEvent = { ...WATCHED, subscriptionId: "sub-nobody-here-holds" };
    const mock = handshakingServer((socket) => {
      socket.write(`${JSON.stringify({ type: "event", event: foreign })}\n`);
    });
    server = mock.server;
    await new Promise<void>((resolve) => mock.server.listen(mock.socketPath, resolve));

    const client = await connect({ socketPath: mock.socketPath });
    const seen: ChangeEvent[] = [];
    client.onChangeEvent((event) => seen.push(event));
    poke(client);
    await settle();

    expect(seen).toEqual([foreign]);
    client.close();
  });

  it("does not replay an earlier event to a listener registered afterwards", async () => {
    const mock = handshakingServer((socket) => {
      socket.write(`${JSON.stringify({ type: "event", event: WATCHED })}\n`);
    });
    server = mock.server;
    await new Promise<void>((resolve) => mock.server.listen(mock.socketPath, resolve));

    const client = await connect({ socketPath: mock.socketPath });
    poke(client);
    await settle();

    const late: ChangeEvent[] = [];
    client.onChangeEvent((event) => late.push(event));
    await settle();

    // Stated as behaviour, not discovered: there is no buffer, because a
    // change stream that replays history reports a past that may no longer be
    // true.
    expect(late).toEqual([]);
    client.close();
  });

  it("stops delivering to a listener that removed itself", async () => {
    const mock = handshakingServer((socket) => {
      socket.write(`${JSON.stringify({ type: "event", event: WATCHED })}\n`);
    });
    server = mock.server;
    await new Promise<void>((resolve) => mock.server.listen(mock.socketPath, resolve));

    const client = await connect({ socketPath: mock.socketPath });
    const seen: ChangeEvent[] = [];
    const stop = client.onChangeEvent((event) => seen.push(event));
    poke(client);
    await settle();
    expect(seen).toHaveLength(1);

    stop();
    poke(client);
    await settle();
    expect(seen).toHaveLength(1);
    client.close();
  });

  it("survives a listener that throws, delivering to the others and keeping the read loop alive", async () => {
    const mock = handshakingServer((socket, id, method) => {
      if (method === "queryElements") socket.write(`${JSON.stringify({ type: "event", event: WATCHED })}\n`);
      else socket.write(`${JSON.stringify({ type: "response", id, result: { elements: [] } })}\n`);
    });
    server = mock.server;
    await new Promise<void>((resolve) => mock.server.listen(mock.socketPath, resolve));

    const client = await connect({ socketPath: mock.socketPath });
    const seen: ChangeEvent[] = [];
    client.onChangeEvent(() => {
      throw new Error("a listener that cannot cope");
    });
    client.onChangeEvent((event) => seen.push(event));
    poke(client);
    await settle();

    expect(seen).toEqual([WATCHED]);
    // The connection is still usable afterwards.
    await expect(client.attestElement({ id: "el-0123456789ab" })).resolves.toEqual({ elements: [] });
    client.close();
  });

  it("still rejects pending requests when the socket dies, with listeners attached", async () => {
    const mock = handshakingServer((socket) => {
      socket.write(`${JSON.stringify({ type: "event", event: WATCHED })}\n`);
      socket.destroy();
    });
    server = mock.server;
    await new Promise<void>((resolve) => mock.server.listen(mock.socketPath, resolve));

    const client = await connect({ socketPath: mock.socketPath });
    client.onChangeEvent(() => undefined);

    await expect(client.queryElements({})).rejects.toThrow(/closed/);
    client.close();
  });
});

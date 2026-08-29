import { mkdtempSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import { connect } from "../index.js";

// The digest handshake, tested from the transport's side against a mock
// server. The mock lives INSIDE packages/transport on purpose: B5 forbids
// socket code anywhere else, and this package is the one place a socket
// counterpart may exist. The daemon's side of the same handshake is exercised
// end-to-end in the Phase 3 verification gate.

const WRONG_DIGEST = "f".repeat(64);

function mockServer(onLine: (socket: Socket, line: string) => void): { server: Server; socketPath: string } {
  const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-transport-")), "mock.sock");
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

describe("a transport built against a different schema digest than the daemon's is refused at connect", () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  it("refuses when the server's hello names a different digest, naming both digests", async () => {
    const mock = mockServer((socket) => {
      socket.write(`${JSON.stringify({ type: "hello", digest: WRONG_DIGEST })}\n`);
    });
    server = mock.server;
    await new Promise<void>((resolve) => mock.server.listen(mock.socketPath, resolve));

    await expect(connect({ socketPath: mock.socketPath })).rejects.toThrow(
      new RegExp(`${SCHEMA_DIGEST}[\\s\\S]*${WRONG_DIGEST}`),
    );
  });

  it("surfaces a server-side refusal line as the connect error, verbatim", async () => {
    const refusal = `daemon: refused at connect - this daemon speaks schema digest ${WRONG_DIGEST} but the transport was built against schema digest ${SCHEMA_DIGEST} (digest-agreement check)`;
    const mock = mockServer((socket) => {
      socket.write(`${JSON.stringify({ type: "refusal", refusal })}\n`);
      socket.end();
    });
    server = mock.server;
    await new Promise<void>((resolve) => mock.server.listen(mock.socketPath, resolve));

    await expect(connect({ socketPath: mock.socketPath })).rejects.toThrow(refusal);
  });

  it("refuses a non-JSON line from the peer with a named error instead of dying in the event handler", async () => {
    const mock = mockServer((socket, line) => {
      const message = JSON.parse(line) as { type: string };
      if (message.type === "hello") {
        // A foreign process squatting the socket path: answers with garbage.
        socket.write("this is not json\n");
      }
    });
    server = mock.server;
    await new Promise<void>((resolve) => mock.server.listen(mock.socketPath, resolve));

    await expect(connect({ socketPath: mock.socketPath })).rejects.toThrow(
      /transport: peer at .* sent a non-JSON line - refusing to continue/,
    );
  });

  it("rejects an in-flight request when the peer turns to garbage mid-session, rather than hanging it", async () => {
    const mock = mockServer((socket, line) => {
      const message = JSON.parse(line) as { type: string };
      if (message.type === "hello") {
        socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
      } else {
        socket.write("garbage after a clean handshake\n");
      }
    });
    server = mock.server;
    await new Promise<void>((resolve) => mock.server.listen(mock.socketPath, resolve));

    const client = await connect({ socketPath: mock.socketPath });
    await expect(client.queryElements({})).rejects.toThrow(/sent a non-JSON line/);
    client.close();
  });

  it("connects and carries a round trip when the digests agree", async () => {
    const mock = mockServer((socket, line) => {
      const message = JSON.parse(line) as { type: string; id?: number; digest?: string };
      if (message.type === "hello") {
        expect(message.digest).toBe(SCHEMA_DIGEST);
        socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
      } else if (message.type === "request") {
        socket.write(
          `${JSON.stringify({ type: "response", id: message.id, result: { elements: [] } })}\n`,
        );
      }
    });
    server = mock.server;
    await new Promise<void>((resolve) => mock.server.listen(mock.socketPath, resolve));

    const client = await connect({ socketPath: mock.socketPath });
    const result = await client.queryElements({});
    expect(result).toEqual({ elements: [] });
    client.close();
  });
});

import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";

// A peer that answers the hello with whatever digest it is told to. It lives in
// packages/transport because B5 forbids socket code anywhere else, and it is
// exported rather than inlined so packages built ON the transport can drive the
// same refusal through their own front door without growing a second dial.
//
// Test scaffolding, not shipped surface: this file sits under __tests__, so the
// tarball's `files` list never sees it.

export interface MockDaemon {
  socketPath?: string;
  url?: string;
  close(): void;
}

export function mockSocketDaemon(digest: string): Promise<MockDaemon> {
  const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-mock-")), "mock.sock");
  const server: Server = createServer((socket) => {
    socket.on("data", () => {
      socket.write(`${JSON.stringify({ type: "hello", digest })}\n`);
    });
  });
  return new Promise((resolve) => {
    server.listen(socketPath, () => {
      resolve({ socketPath, close: () => server.close() });
    });
  });
}

export async function mockWebSocketDaemon(digest: string): Promise<MockDaemon> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.on("listening", resolve));
  server.on("connection", (socket) => {
    socket.on("message", () => {
      socket.send(`${JSON.stringify({ type: "hello", digest })}\n`);
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { url: `ws://127.0.0.1:${port}`, close: () => server.close() };
}

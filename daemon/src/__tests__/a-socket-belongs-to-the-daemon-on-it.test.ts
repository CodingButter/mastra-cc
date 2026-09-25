import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { connect as netConnect, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import { registry } from "../backends/registry.js";
import { startServer } from "../server.js";

// A socket path belongs to the daemon listening on it (ADR-0115). Starting a
// second daemon on a live path must refuse, never unlink the first's socket.
// This file may open a raw socket: the daemon is its server, not a second client.

function hello(socketPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(socketPath);
    socket.once("error", reject);
    socket.once("data", (chunk) => {
      socket.destroy();
      resolve(chunk.toString("utf8"));
    });
    socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
  });
}

const tempSocket = () => join(mkdtempSync(join(tmpdir(), "mastra-cc-own-")), "daemon.sock");
const backend = () => registry.replay({ visibility: "all" });

describe("a socket belongs to the daemon listening on it", () => {
  it("refuses a second daemon on a live path, and the first keeps serving", async () => {
    const socketPath = tempSocket();
    const first = await startServer({ socketPath, backend: backend() });
    try {
      await expect(startServer({ socketPath, backend: backend() })).rejects.toThrow(/already listening at/);
      expect(existsSync(socketPath)).toBe(true);
      expect(await hello(socketPath)).toContain('"hello"');
    } finally {
      first.close();
    }
  });

  it("takes over a stale socket file nobody is listening on", async () => {
    const socketPath = tempSocket();
    const dead: Server = createServer();
    await new Promise<void>((r) => dead.listen(socketPath, r));
    // Simulate a crashed daemon: the file stays, nothing accepts.
    await new Promise<void>((r) => dead.close(() => r()));
    if (!existsSync(socketPath)) writeFileSync(socketPath, "");
    const server = await startServer({ socketPath, backend: backend() });
    try {
      expect(await hello(socketPath)).toContain('"hello"');
    } finally {
      server.close();
    }
  });

  it("starts on a path where nothing exists yet", async () => {
    const server = await startServer({ socketPath: tempSocket(), backend: backend() });
    server.close();
  });
});

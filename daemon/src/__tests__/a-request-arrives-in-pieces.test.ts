import { mkdtempSync } from "node:fs";
import { connect as netConnect, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import { registry } from "../backends/registry.js";
import { MAX_REQUEST_LINE_CHARS, startServer } from "../server.js";

// TCP delivers bytes, not characters. A request whose multi-byte characters
// straddle two chunks must be read intact (audit C2), and a peer that never
// ends its line must be refused rather than buffered forever (audit M1).
// This file may open a raw socket: the daemon is its server, not a second client.

function lines(socket: Socket, count: number): Promise<string[]> {
  return new Promise((resolve) => {
    const seen: string[] = [];
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        seen.push(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (seen.length >= count) resolve(seen);
      }
    });
  });
}

describe("a request that arrives in pieces", () => {
  let server: Server;
  const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-pieces-")), "daemon.sock");

  beforeAll(async () => {
    server = await startServer({ socketPath, backend: registry.replay({ visibility: "all" }) });
  });
  afterAll(() => {
    server.close();
  });

  it("joins a multi-byte character split across two chunks instead of corrupting it", async () => {
    const socket = netConnect(socketPath);
    const received = lines(socket, 2);
    socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
    const method = `no—such—method`;
    const bytes = Buffer.from(`${JSON.stringify({ type: "request", id: 1, method, params: {} })}\n`, "utf8");
    const middleOfADash = bytes.indexOf(Buffer.from("—", "utf8")) + 1;
    socket.write(bytes.subarray(0, middleOfADash));
    await new Promise((r) => setTimeout(r, 20));
    socket.write(bytes.subarray(middleOfADash));
    const [, answer] = await received;
    expect(answer).toContain(method);
    expect(answer).not.toContain("\uFFFD");
    socket.destroy();
  });

  it("refuses and closes a line that never ends, rather than buffering it without bound", async () => {
    const socket = netConnect(socketPath);
    const received = lines(socket, 2);
    const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
    socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
    const piece = "x".repeat(1024 * 1024);
    for (let i = 0; i <= MAX_REQUEST_LINE_CHARS / piece.length; i++) socket.write(piece);
    const [, refusal] = await received;
    expect(JSON.parse(refusal)).toMatchObject({ type: "refusal" });
    expect(refusal).toContain("without a newline");
    await closed;
  });
});

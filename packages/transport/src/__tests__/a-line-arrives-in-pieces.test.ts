import { mkdtempSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import { connect, MAX_LINE_CHARS } from "../index.js";

const CAP = 64 * 1024;

// TCP delivers bytes, not characters. A reply whose multi-byte characters
// straddle two chunks must reach the caller intact (audit C2), and a peer
// that never ends its line must not grow the client's memory forever (M1).

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

function peer(onRequest: (socket: Socket, id: number) => void): Promise<string> {
  const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-pieces-")), "mock.sock");
  server = createServer((socket) => {
    socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
    socket.on("error", () => {});
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const message = JSON.parse(buffer.slice(0, newline)) as { type: string; id?: number };
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (message.type === "request" && typeof message.id === "number") onRequest(socket, message.id);
      }
    });
  });
  return new Promise((resolve) => server!.listen(socketPath, () => resolve(socketPath)));
}

describe("a line that arrives in pieces", () => {
  it("joins a multi-byte character split across two chunks instead of corrupting it", async () => {
    const text = "—".repeat(5000);
    const socketPath = await peer((socket, id) => {
      const bytes = Buffer.from(`${JSON.stringify({ type: "response", id, result: { text } })}\n`, "utf8");
      const middleOfADash = bytes.indexOf(Buffer.from("—", "utf8")) + 1;
      socket.write(bytes.subarray(0, middleOfADash));
      setTimeout(() => socket.write(bytes.subarray(middleOfADash)), 20);
    });
    const client = await connect({ socketPath });
    const result = (await client.listApplications({})) as unknown as { text: string };
    expect(result.text).toBe(text);
    client.close();
  });

  it("refuses a peer whose line never ends, rather than buffering it without bound", async () => {
    const socketPath = await peer((socket) => {
      const piece = "x".repeat(1024);
      for (let i = 0; i <= CAP / piece.length; i++) socket.write(piece);
    });
    const client = await connect({ socketPath, maxLineChars: CAP });
    await expect(client.listApplications({})).rejects.toThrow(/longer than .* without a newline/);
  });

  it("keeps the production cap generous enough for a base64 capture", () => {
    expect(MAX_LINE_CHARS).toBe(64 * 1024 * 1024);
  });
});

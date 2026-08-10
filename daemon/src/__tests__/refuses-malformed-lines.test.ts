import { mkdtempSync } from "node:fs";
import { connect as netConnect, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import { registry } from "../backends/registry.js";
import { startServer } from "../server.js";

// Every line the daemon cannot serve gets a NAMED refusal, never silence.
// A swallowed line leaves the client's pending promise hanging forever -
// a hang is not a refusal. (Phase 7 adversarial review, must-fix 3.)
// This file may open a raw socket: B5 scans client-side code only, and the
// daemon is the socket's server, not a second client.

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

describe("the daemon refuses malformed lines loudly instead of swallowing them", () => {
  let server: Server;
  const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-malformed-")), "daemon.sock");

  beforeAll(async () => {
    // visibility "all": this file witnesses wire framing, not grant policy
    server = await startServer({ socketPath, backend: registry.replay({ visibility: "all" }) });
  });
  afterAll(() => {
    server.close();
  });

  it("answers valid JSON that is not a well-formed request with a refusal naming the required shape", async () => {
    const socket = netConnect(socketPath);
    const received = lines(socket, 2);
    socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
    socket.write(`${JSON.stringify({ type: "chatter", id: "not-a-number" })}\n`);
    const [hello, refusal] = await received;
    expect(JSON.parse(hello).type).toBe("hello");
    const parsed = JSON.parse(refusal) as { type: string; refusal: string };
    expect(parsed.type).toBe("refusal");
    expect(parsed.refusal).toContain('{type:"request", id:number, method:string}');
    socket.destroy();
  });

  it("answers a non-JSON line with a refusal and keeps serving the connection", async () => {
    const socket = netConnect(socketPath);
    const received = lines(socket, 3);
    socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
    socket.write("this is not json\n");
    socket.write(`${JSON.stringify({ type: "request", id: 1, method: "queryElements", params: {} })}\n`);
    const [, refusal, response] = await received;
    expect((JSON.parse(refusal) as { refusal: string }).refusal).toContain("not a JSON line");
    const parsed = JSON.parse(response) as { type: string; id: number; result: { elements: unknown[] } };
    expect(parsed.id).toBe(1);
    expect(parsed.result.elements.length).toBeGreaterThan(0);
    socket.destroy();
  });
});

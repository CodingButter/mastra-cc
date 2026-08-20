import { mkdtempSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { METHOD_NAMES, SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import { connect, type TransportClient } from "../index.js";

// A METHOD WITH NO BINDING IS A METHOD NO CLIENT CAN CALL.
//
// The daemon serves thirteen methods. For most of this package's life it bound
// five - the ones that observe and the one that launches - and the eight that
// ACT were reachable only by writing socket code, which pin B5 forbids
// everywhere except here. So the daemon's headline claim, that it acts, could
// not be exercised by any independent client.
//
// The list this checks against is METHOD_NAMES, which is GENERATED from
// protocol/schema.json. That matters more than the eight bindings added today:
// a method added to the contract tomorrow and never bound here fails this test
// without anyone remembering to update it. A hand-written list of thirteen
// names would pass forever by saying nothing.
//
// The mock server lives inside this package on purpose (B5). It answers the
// digest handshake and then echoes back the method it was asked for, so what is
// asserted is the NAME that went onto the wire - not that a promise resolved.

function mockDaemon(): { server: Server; socketPath: string; asked: string[] } {
  const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-reach-")), "mock.sock");
  const asked: string[] = [];
  const server = createServer((socket: Socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.trim()) continue;
        const message = JSON.parse(line) as { type: string; id?: number; method?: string; params?: unknown };
        if (message.type === "hello") {
          socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
        } else if (message.type === "request") {
          asked.push(message.method as string);
          // Echo the method back as the result. The daemon's real results are
          // the daemon's business; what this file is about is whether the call
          // reaches the wire under the right name.
          socket.write(`${JSON.stringify({ type: "response", id: message.id, result: { method: message.method, params: message.params } })}\n`);
        }
      }
    });
  });
  return { server, socketPath, asked };
}

// Params good enough to be sent. The mock does not validate them; the daemon's
// own suite is where parameter meaning is decided.
const PARAMS: Record<string, unknown> = {
  queryElements: {},
  attestElement: { id: "el-0123456789ab" },
  subscribeElement: { id: "el-0123456789ab" },
  unsubscribeElement: { subscriptionId: "sub-1" },
  openApplication: { name: "yad" },
  editElement: { id: "el-0123456789ab", value: "typed" },
  activateElement: { id: "el-0123456789ab", action: "click" },
  submitElement: { id: "el-0123456789ab", attestation: "commits the form" },
  setElementValue: { id: "el-0123456789ab", value: 0.5 },
  setElementText: { id: "el-0123456789ab", text: "typed" },
  setElementCaret: { id: "el-0123456789ab", offset: 3 },
  revealElement: { id: "el-0123456789ab" },
  listApplications: {},
};

describe("every method the contract declares is reachable through this client", () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  it("binds all thirteen, and puts each one on the wire under its own name", async () => {
    const mock = mockDaemon();
    server = mock.server;
    await new Promise<void>((resolve) => mock.server.listen(mock.socketPath, resolve));
    const client = await connect({ socketPath: mock.socketPath });

    for (const method of METHOD_NAMES) {
      const binding = (client as unknown as Record<string, (params: unknown) => Promise<unknown>>)[method];
      expect(binding, `${method} has no binding on the transport client`).toBeTypeOf("function");
      const result = (await binding.call(client, PARAMS[method])) as { method: string };
      // The method name is asserted from the RESULT the mock echoed, which is
      // the only place the name that actually travelled can be read.
      expect(result.method, `${method} was called but a different name reached the wire`).toBe(method);
    }

    client.close();
    expect(mock.asked).toEqual([...METHOD_NAMES]);
  });

  it("carries the caller's parameters through untouched", async () => {
    // The transport owns framing and correlation and nothing else (ADR-0003).
    // A binding that filled in a default, renamed a field, or dropped one the
    // daemon would have refused would be a second implementation of the
    // protocol - and the digest handshake cannot detect a disagreement it is
    // never told about.
    const mock = mockDaemon();
    server = mock.server;
    await new Promise<void>((resolve) => mock.server.listen(mock.socketPath, resolve));
    const client = await connect({ socketPath: mock.socketPath });

    const sent = { id: "el-0123456789ab", text: "typed", offset: 3 };
    const echoed = (await client.setElementText(sent)) as unknown as { params: unknown };
    client.close();

    expect(echoed.params).toEqual(sent);
  });

  it("hands a refusal back as a refusal, for an acting method as for an observing one", async () => {
    // The eight new bindings inherit the refusal path the five old ones use.
    // This asserts that inheritance rather than assuming it: a refusal that
    // arrived as a resolved promise would read to a caller as "it worked".
    const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-refuse-")), "mock.sock");
    const refusing = createServer((socket: Socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line.trim()) continue;
          const message = JSON.parse(line) as { type: string; id?: number };
          if (message.type === "hello") socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
          else socket.write(`${JSON.stringify({ type: "response", id: message.id, refusal: "refused by the scope gate" })}\n`);
        }
      });
    });
    server = refusing;
    await new Promise<void>((resolve) => refusing.listen(socketPath, resolve));
    const client: TransportClient = await connect({ socketPath });

    await expect(client.submitElement({ id: "el-0123456789ab", attestation: "commits" })).rejects.toThrow(
      /refused by the scope gate/,
    );
    client.close();
  });
});

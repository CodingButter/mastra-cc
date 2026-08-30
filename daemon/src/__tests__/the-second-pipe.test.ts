import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import {
  type Backend,
  type BackendChange,
  UnknownSubscriptionError,
  UnwatchableElementError,
  mintSubscriptionId,
} from "../backend.js";
import { startWebSocketServer, type WebSocketListener } from "../server.js";
import { registry } from "../backends/registry.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// The second pipe carries the SAME wire. Not a similar wire: the same refusal
// strings, byte for byte, with the same trailing newline, and the same framing
// - a WebSocket peer that packs two lines into one frame, or splits one across
// two, gets exactly what a socket peer doing the same would get. The frame
// boundary tests below are the ones that fail first if a second framing rule
// ever sneaks in beside the shared one.
//
// The client here is Node's GLOBAL WebSocket, the same one the CDP backend
// dials with, so these tests exercise a real RFC 6455 peer rather than the
// server library talking to itself.

const WATCHED = "el-0123456789ab";

function watchableBackend() {
  const closed: string[] = [];
  const sinks = new Map<string, (change: BackendChange) => void>();
  const backend: Backend = {
    ...observeOnlyEffects,
    name: "watchable",
    queryElements: async () => ({ elements: [] }),
    attestElement: async () => ({}),
    readElementContent: async () => ({ content: { kind: "unavailable", reason: "not-exposed" } }),
    subscribeElement: async (id, sink) => {
      if (id !== WATCHED) throw new UnwatchableElementError(id);
      const subscriptionId = mintSubscriptionId();
      sinks.set(subscriptionId, sink);
      return {
        subscriptionId,
        application: "test-app",
        close: async () => {
          closed.push(subscriptionId);
          sinks.delete(subscriptionId);
        },
      };
    },
    applicationOfElement: () => undefined,
    unsubscribeElement: async (subscriptionId) => {
      if (!sinks.has(subscriptionId)) throw new UnknownSubscriptionError(subscriptionId);
      closed.push(subscriptionId);
      sinks.delete(subscriptionId);
    },
    close: async () => undefined,
  };
  return { backend, closed, get open() { return sinks.size; } };
}

/** every payload the daemon wrote, kept whole - newline and all */
function client(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const payloads: string[] = [];
  const opened = new Promise<void>((resolve) => socket.addEventListener("open", () => resolve(), { once: true }));
  let closeCode: number | undefined;
  socket.addEventListener("message", (event) => payloads.push(String(event.data)));
  socket.addEventListener("close", (event) => {
    closeCode = event.code;
  });
  return {
    socket,
    payloads,
    opened,
    get closed() {
      return closeCode !== undefined;
    },
    async send(text: string) {
      await opened;
      socket.send(text);
    },
    /** the parsed lines, splitting each payload the way any reader must */
    lines(): { type: string; id?: number; refusal?: string; result?: unknown; event?: unknown }[] {
      return payloads
        .join("")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line));
    },
    async waitFor(count: number, what: string) {
      const deadline = Date.now() + 2000;
      for (;;) {
        if (this.lines().length >= count) return this.lines();
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; saw ${JSON.stringify(this.payloads)}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
    async waitForClose() {
      const deadline = Date.now() + 2000;
      while (!this.closed) {
        if (Date.now() > deadline) throw new Error("timed out waiting for the daemon to end the connection");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
  };
}

const hello = `${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`;

describe("the daemon serves the same protocol over a websocket", () => {
  let listener: WebSocketListener | undefined;
  let socket: WebSocket | undefined;

  afterEach(() => {
    socket?.close();
    listener?.close();
    listener = undefined;
  });

  async function listen(backend?: Backend) {
    listener = await startWebSocketServer({
      port: 0,
      backend: backend ?? registry.replay({ visibility: "all" }),
      visibility: "all",
    });
    return listener;
  }

  it("binds the port the kernel chose and reports it back", async () => {
    const bound = await listen();
    expect(bound.port).toBeGreaterThan(0);
    expect(bound.host).toBe("127.0.0.1");
  });

  it("answers hello with the digest and version, trailing newline intact", async () => {
    const bound = await listen();
    const c = client(bound.port);
    socket = c.socket;
    await c.send(hello);
    await c.waitFor(1, "the hello reply");
    expect(c.payloads[0].endsWith("\n")).toBe(true);
    expect(JSON.parse(c.payloads[0])).toEqual({ type: "hello", digest: SCHEMA_DIGEST, version: PROTOCOL_VERSION });
  });

  it("answers a real request on the same pipe", async () => {
    const bound = await listen();
    const c = client(bound.port);
    socket = c.socket;
    await c.send(hello);
    await c.send(`${JSON.stringify({ type: "request", id: 7, method: "queryElements", params: {} })}\n`);
    const lines = await c.waitFor(2, "the query answer");
    const answer = lines[1] as { id: number; result: { elements: unknown[] } };
    expect(answer.id).toBe(7);
    expect(answer.result.elements.length).toBeGreaterThan(0);
  });

  it("refuses a first message that is not hello with the byte-identical refusal", async () => {
    const bound = await listen();
    const c = client(bound.port);
    socket = c.socket;
    await c.send(`${JSON.stringify({ type: "request", id: 1, method: "queryElements", params: {} })}\n`);
    await c.waitFor(1, "the hello-gate refusal");
    expect(c.payloads[0]).toBe(
      `${JSON.stringify({ type: "refusal", refusal: "daemon: hello with a schema digest must come first" })}\n`,
    );
    await c.waitForClose();
  });

  it("refuses a hello carrying the wrong digest, byte for byte, and closes", async () => {
    const bound = await listen();
    const c = client(bound.port);
    socket = c.socket;
    await c.send(`${JSON.stringify({ type: "hello", digest: "deadbeefcafe" })}\n`);
    await c.waitFor(1, "the digest refusal");
    expect(c.payloads[0]).toBe(
      `${JSON.stringify({
        type: "refusal",
        refusal:
          `daemon: refused at connect - this daemon speaks schema digest ${SCHEMA_DIGEST} ` +
          `but the transport was built against schema digest deadbeefcafe (digest-agreement check)`,
      })}\n`,
    );
    await c.waitForClose();
  });

  it("abandons the rest of the frame when the hello gate refuses mid-buffer", async () => {
    const bound = await listen();
    const c = client(bound.port);
    socket = c.socket;
    await c.send(`${JSON.stringify({ type: "hello", digest: "deadbeefcafe" })}\n${hello}`);
    await c.waitForClose();
    expect(c.lines()).toHaveLength(1);
    expect(c.lines()[0].type).toBe("refusal");
  });

  it("answers twice for two messages in one frame", async () => {
    const bound = await listen();
    const c = client(bound.port);
    socket = c.socket;
    await c.send(`${hello}${JSON.stringify({ type: "chatter" })}\n`);
    const lines = await c.waitFor(2, "both answers");
    expect(lines[0].type).toBe("hello");
    expect(lines[1].type).toBe("refusal");
  });

  it("answers once for one message split across two frames", async () => {
    const bound = await listen();
    const c = client(bound.port);
    socket = c.socket;
    await c.send(hello.slice(0, 10));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(c.payloads).toHaveLength(0);
    await c.send(hello.slice(10));
    const lines = await c.waitFor(1, "the hello reply");
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe("hello");
  });

  it("closes a dropped connection's watches at the backend, not merely forgets them", async () => {
    const desktop = watchableBackend();
    const bound = await listen(desktop.backend);
    const c = client(bound.port);
    socket = c.socket;
    await c.send(hello);
    await c.send(`${JSON.stringify({ type: "request", id: 1, method: "subscribeElement", params: { id: WATCHED, priority: "high" } })}\n`);
    await c.waitFor(2, "the subscription");
    expect(desktop.open).toBe(1);
    c.socket.close();
    const deadline = Date.now() + 2000;
    while (desktop.closed.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(desktop.closed).toHaveLength(1);
    expect(desktop.open).toBe(0);
  });
});

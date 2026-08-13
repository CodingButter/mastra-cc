import { mkdtempSync } from "node:fs";
import { connect as netConnect, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ChangeEvent, SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import {
  type Backend,
  type BackendChange,
  UnknownSubscriptionError,
  UnwatchableElementError,
  mintSubscriptionId,
} from "../backend.js";
import { startServer } from "../server.js";

// A watch belongs to the connection that asked for it, and it dies with that
// connection - at the BACKEND, not merely in a map (ADR-0039). A forgotten
// watch is still being fed: the desktop keeps talking to a listener nobody
// reads, which is a leak the daemon would never notice.
// This file may open a raw socket: B5 scans client-side code only, and the
// daemon is the socket's server, not a second client.

const WATCHED = "el-0123456789ab";

/** A backend whose watches can be driven and whose closures can be counted. */
function watchableBackend() {
  const closed: string[] = [];
  const sinks = new Map<string, (change: BackendChange) => void>();
  const backend: Backend = {
    name: "watchable",
    queryElements: async () => ({ elements: [] }),
    attestElement: async () => ({}),
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
    unsubscribeElement: async (subscriptionId) => {
      if (!sinks.has(subscriptionId)) throw new UnknownSubscriptionError(subscriptionId);
      closed.push(subscriptionId);
      sinks.delete(subscriptionId);
    },
    close: async () => undefined,
  };
  return {
    backend,
    closed,
    /** what the desktop said, pushed into every open watch */
    push(change: BackendChange) {
      for (const sink of [...sinks.values()]) sink(change);
    },
    get open() {
      return sinks.size;
    },
  };
}

type Line = { type: string; id?: number; result?: unknown; refusal?: string; event?: ChangeEvent };

/** A raw client that keeps every line the daemon wrote, in order. */
function client(socketPath: string) {
  const socket = netConnect(socketPath);
  const seen: Line[] = [];
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      seen.push(JSON.parse(buffer.slice(0, newline)) as Line);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  });
  socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
  return {
    socket,
    seen,
    request(id: number, method: string, params: unknown) {
      socket.write(`${JSON.stringify({ type: "request", id, method, params })}\n`);
    },
    /** the next line satisfying a predicate, within a bounded wait */
    async waitFor(match: (line: Line) => boolean, what: string): Promise<Line> {
      const deadline = Date.now() + 2000;
      for (;;) {
        const found = seen.find(match);
        if (found !== undefined) return found;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; saw ${JSON.stringify(seen)}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
  };
}

describe("a watch lives and dies with the connection that asked for it", () => {
  let server: Server | undefined;
  let socket: Socket | undefined;
  const socketPath = () => join(mkdtempSync(join(tmpdir(), "mastra-cc-watch-")), "daemon.sock");

  afterEach(() => {
    socket?.destroy();
    server?.close();
  });

  it("answers a subscription that echoes the element and the priority it was asked for", async () => {
    const desktop = watchableBackend();
    const path = socketPath();
    server = await startServer({ socketPath: path, backend: desktop.backend });
    const c = client(path);
    socket = c.socket;
    c.request(1, "subscribeElement", { id: WATCHED, priority: "high" });
    const answer = await c.waitFor((line) => line.id === 1, "the subscription");
    const result = answer.result as { subscription?: { subscriptionId: string; id: string; priority: string } };
    expect(result.subscription?.id).toBe(WATCHED);
    expect(result.subscription?.priority).toBe("high");
    expect(result.subscription?.subscriptionId).not.toBe("");
  });

  it("pushes a change as an id-less event line, stamped with an attribution", async () => {
    const desktop = watchableBackend();
    const path = socketPath();
    server = await startServer({ socketPath: path, backend: desktop.backend });
    const c = client(path);
    socket = c.socket;
    c.request(1, "subscribeElement", { id: WATCHED, priority: "low" });
    await c.waitFor((line) => line.id === 1, "the subscription");
    desktop.push({ id: WATCHED, role: "textbox", kind: "changed" });
    const pushed = await c.waitFor((line) => line.type === "event", "the change event");
    // No id: an event answers nothing, so it cannot be mistaken for a response
    // to a request the client never made.
    expect(pushed.id).toBeUndefined();
    expect(pushed.event?.id).toBe(WATCHED);
    expect(pushed.event?.kind).toBe("changed");
    // Nothing of ours was in flight, so the change is news - labelled, never
    // flagged (ADR-0032 clause 4).
    expect(pushed.event?.attribution).toBe("external");
    expect(pushed.event?.causeId).toBeUndefined();
    expect(pushed.event?.priority).toBe("low");
  });

  it("closes the BACKEND subscription when the socket dies, not merely its own book", async () => {
    const desktop = watchableBackend();
    const path = socketPath();
    server = await startServer({ socketPath: path, backend: desktop.backend });
    const c = client(path);
    socket = c.socket;
    c.request(1, "subscribeElement", { id: WATCHED, priority: "medium" });
    const answer = await c.waitFor((line) => line.id === 1, "the subscription");
    const subscriptionId = (answer.result as { subscription: { subscriptionId: string } }).subscription.subscriptionId;
    expect(desktop.open).toBe(1);
    c.socket.destroy();
    const deadline = Date.now() + 2000;
    while (desktop.open > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    // The watch is closed where it was established. A daemon that only cleared
    // its own map would leave the desktop feeding a listener nobody reads.
    expect(desktop.closed).toContain(subscriptionId);
    expect(desktop.open).toBe(0);
  });

  it("ends a watch on request and reports that this call is what ended it", async () => {
    const desktop = watchableBackend();
    const path = socketPath();
    server = await startServer({ socketPath: path, backend: desktop.backend });
    const c = client(path);
    socket = c.socket;
    c.request(1, "subscribeElement", { id: WATCHED, priority: "low" });
    const answer = await c.waitFor((line) => line.id === 1, "the subscription");
    const subscriptionId = (answer.result as { subscription: { subscriptionId: string } }).subscription.subscriptionId;
    c.request(2, "unsubscribeElement", { subscriptionId });
    const ended = await c.waitFor((line) => line.id === 2, "the unsubscribe answer");
    expect((ended.result as { ended?: boolean }).ended).toBe(true);
    expect(desktop.open).toBe(0);
  });

  it("ends loudly when the watched element vanishes, and never re-anchors", async () => {
    const desktop = watchableBackend();
    const path = socketPath();
    server = await startServer({ socketPath: path, backend: desktop.backend });
    const c = client(path);
    socket = c.socket;
    c.request(1, "subscribeElement", { id: WATCHED, priority: "high" });
    const answer = await c.waitFor((line) => line.id === 1, "the subscription");
    const subscriptionId = (answer.result as { subscription: { subscriptionId: string } }).subscription.subscriptionId;
    desktop.push({ id: WATCHED, role: "textbox", kind: "watchEnded" });
    const terminal = await c.waitFor((line) => line.type === "event", "the terminal event");
    // The event NAMES the element that vanished. The alternative - going quiet
    // - is a silence indistinguishable from a calm desktop, and re-resolving
    // the name would silently move the watch onto a different element.
    expect(terminal.event?.kind).toBe("watchEnded");
    expect(terminal.event?.id).toBe(WATCHED);
    expect(terminal.event?.subscriptionId).toBe(subscriptionId);
    const deadline = Date.now() + 2000;
    while (desktop.open > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(desktop.open).toBe(0);
    // Ending a watch that already ended itself is not an error: the answer
    // says the watch is not running, which is the state the caller wanted.
    c.request(2, "unsubscribeElement", { subscriptionId });
    const ended = await c.waitFor((line) => line.id === 2, "the unsubscribe answer");
    expect((ended.result as { ended?: boolean }).ended).toBe(false);
  });

  it("delivers nothing more after the watch ended itself", async () => {
    const desktop = watchableBackend();
    const path = socketPath();
    server = await startServer({ socketPath: path, backend: desktop.backend });
    const c = client(path);
    socket = c.socket;
    c.request(1, "subscribeElement", { id: WATCHED, priority: "low" });
    await c.waitFor((line) => line.id === 1, "the subscription");
    desktop.push({ id: WATCHED, role: "textbox", kind: "watchEnded" });
    await c.waitFor((line) => line.type === "event", "the terminal event");
    desktop.push({ id: WATCHED, role: "textbox", kind: "changed" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(c.seen.filter((line) => line.type === "event")).toHaveLength(1);
  });

  it("refuses a watch on an element this session never answered, without saying which reason", async () => {
    const desktop = watchableBackend();
    const path = socketPath();
    server = await startServer({ socketPath: path, backend: desktop.backend });
    const c = client(path);
    socket = c.socket;
    c.request(1, "subscribeElement", { id: "el-ffffffffffff", priority: "low" });
    const answer = await c.waitFor((line) => line.id === 1, "the refusal");
    const refusal = (answer.result as { refusal?: string }).refusal ?? "";
    expect(refusal).toContain("no element with that id was ever answered");
    // The refusal names the check, not the element: an id that names nothing
    // and an id inside an invisible application must be indistinguishable.
    expect(refusal).not.toContain("el-ffffffffffff");
  });

  it("refuses to end a watch this connection does not hold", async () => {
    const desktop = watchableBackend();
    const path = socketPath();
    server = await startServer({ socketPath: path, backend: desktop.backend });
    const c = client(path);
    socket = c.socket;
    c.request(1, "unsubscribeElement", { subscriptionId: "sub-000000-abcdef" });
    const answer = await c.waitFor((line) => line.id === 1, "the refusal");
    expect((answer.result as { refusal?: string }).refusal).toContain("a watch is per-connection state");
  });

  it("gives each connection its own book: one connection's watch is not another's to end", async () => {
    const desktop = watchableBackend();
    const path = socketPath();
    server = await startServer({ socketPath: path, backend: desktop.backend });
    const first = client(path);
    socket = first.socket;
    first.request(1, "subscribeElement", { id: WATCHED, priority: "low" });
    const answer = await first.waitFor((line) => line.id === 1, "the subscription");
    const subscriptionId = (answer.result as { subscription: { subscriptionId: string } }).subscription.subscriptionId;
    const second = client(path);
    try {
      second.request(1, "unsubscribeElement", { subscriptionId });
      const refused = await second.waitFor((line) => line.id === 1, "the refusal");
      expect((refused.result as { refusal?: string }).refusal).toContain("a watch is per-connection state");
      // and the first connection's watch is untouched
      expect(desktop.open).toBe(1);
    } finally {
      second.socket.destroy();
    }
  });
});

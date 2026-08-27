import { mkdtempSync } from "node:fs";
import { connect as netConnect, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ChangeEvent, SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import {
  type Backend,
  type BackendChange,
  mintSubscriptionId,
  UnknownSubscriptionError,
  UnwatchableElementError,
} from "../backend.js";
import { startServer, SUBSCRIBE_UNKNOWN_REFUSAL } from "../server.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// Deny-by-default on the change stream (ADR-0036, ADR-0008 rule 6). An
// application the operator has not granted is ABSENT, and absent means the
// same answer as never existed - the same bytes, so no client can tell the two
// apart and learn what is running on the machine. Visibility is also re-read
// where events are stamped: a subscription established while an application
// was visible does not keep narrating it afterwards.
// This file may open a raw socket: B5 scans client-side code only, and the
// daemon is the socket's server, not a second client.

const VISIBLE = "el-aaaaaaaaaaaa";
const INVISIBLE = "el-bbbbbbbbbbbb";
const NONEXISTENT = "el-cccccccccccc";

/**
 * A backend that can see both applications. The visibility set the SERVER
 * holds is what this file exercises; a real backend applies its own gate as
 * well, and the two are independent on purpose.
 */
function twoApplications() {
  const sinks = new Map<string, { application: string; sink: (change: BackendChange) => void }>();
  const backend: Backend = {
    ...observeOnlyEffects,
    name: "two-apps",
    queryElements: async () => ({ elements: [] }),
    attestElement: async () => ({}),
    readElementContent: async () => ({ content: { kind: "unavailable", reason: "not-exposed" } }),
    subscribeElement: async (id, sink) => {
      const application = id === VISIBLE ? "seen-app" : id === INVISIBLE ? "unseen-app" : undefined;
      if (application === undefined) {
        throw new UnwatchableElementError(id);
      }
      const subscriptionId = mintSubscriptionId();
      sinks.set(subscriptionId, { application, sink });
      return { subscriptionId, application, close: async () => void sinks.delete(subscriptionId) };
    },
    applicationOfElement: () => undefined,
    unsubscribeElement: async (subscriptionId) => {
      if (!sinks.delete(subscriptionId)) throw new UnknownSubscriptionError(subscriptionId);
    },
    close: async () => undefined,
  };
  return {
    backend,
    push(change: BackendChange) {
      for (const entry of sinks.values()) entry.sink(change);
    },
  };
}

type Line = { type: string; id?: number; result?: unknown; refusal?: string; event?: ChangeEvent };

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

describe("an application outside the visible set is invisible on the change stream too", () => {
  let server: Server | undefined;
  let socket: Socket | undefined;
  const socketPath = () => join(mkdtempSync(join(tmpdir(), "mastra-cc-subvis-")), "daemon.sock");

  afterEach(() => {
    socket?.destroy();
    server?.close();
  });

  it("refuses a watch on an invisible element with the SAME BYTES as a watch on an id that never existed", async () => {
    const desktop = twoApplications();
    const path = socketPath();
    // The backend here would answer both ids; the daemon's own visibility set
    // is what makes one of them unwatchable, and a real backend gate refuses
    // the same way. Either route, one constant.
    server = await startServer({
      socketPath: path,
      backend: {
        ...desktop.backend,
        subscribeElement: async (id, sink) => {
          if (id === INVISIBLE) throw new UnwatchableElementError(id);
          return desktop.backend.subscribeElement(id, sink);
        },
      },
      visibility: new Set(["seen-app"]),
    });
    const c = client(path);
    socket = c.socket;

    c.request(1, "subscribeElement", { id: INVISIBLE, priority: "high" });
    c.request(2, "subscribeElement", { id: NONEXISTENT, priority: "high" });
    const invisible = await c.waitFor((line) => line.id === 1, "the invisible refusal");
    const nonexistent = await c.waitFor((line) => line.id === 2, "the nonexistent refusal");

    // toBe on the full string, deliberately: "similar" refusals are how a
    // probe distinguishes them.
    const refusalOf = (line: Line) => (line.result as { refusal?: string; subscription?: unknown }).refusal;
    expect(refusalOf(invisible)).toBe(SUBSCRIBE_UNKNOWN_REFUSAL);
    expect(refusalOf(nonexistent)).toBe(SUBSCRIBE_UNKNOWN_REFUSAL);
    expect(refusalOf(invisible)).toBe(refusalOf(nonexistent));
    expect((invisible.result as { subscription?: unknown }).subscription).toBeUndefined();
  });

  it("never delivers an event for an application outside the visible set, even on a watch it already granted", async () => {
    const desktop = twoApplications();
    const path = socketPath();
    // The watch on the unseen application is established here - the server's
    // emission-time check is what must silence it, not the subscribe-time one.
    server = await startServer({ socketPath: path, backend: desktop.backend, visibility: new Set(["seen-app"]) });
    const c = client(path);
    socket = c.socket;

    c.request(1, "subscribeElement", { id: INVISIBLE, priority: "high" });
    c.request(2, "subscribeElement", { id: VISIBLE, priority: "high" });
    const unseen = await c.waitFor((line) => line.id === 1, "the unseen application's subscription");
    await c.waitFor((line) => line.id === 2, "the visible subscription");
    // The watch on the unseen application EXISTS - this backend answered it -
    // so silence below is the emission-time check doing the work, not a
    // subscription that was never established.
    expect((unseen.result as { subscription?: unknown }).subscription).toBeDefined();

    desktop.push({ id: "el-000000000000", role: "button", kind: "changed" });
    const delivered = await c.waitFor((line) => line.type === "event", "the visible application's event");

    // Exactly one event: the same change reached both watches, and only the
    // visible application's was narrated.
    expect(delivered.event?.subscriptionId).toBe(
      ((await c.waitFor((line) => line.id === 2, "the visible subscription")).result as {
        subscription: { subscriptionId: string };
      }).subscription.subscriptionId,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(c.seen.filter((line) => line.type === "event")).toHaveLength(1);
  });

  it("carries the priority it was given and behaves identically at all three", async () => {
    const desktop = twoApplications();
    const path = socketPath();
    server = await startServer({ socketPath: path, backend: desktop.backend, visibility: "all" });
    const c = client(path);
    socket = c.socket;

    for (const [id, priority] of [[1, "low"], [2, "medium"], [3, "high"]] as const) {
      c.request(id, "subscribeElement", { id: VISIBLE, priority });
      await c.waitFor((line) => line.id === id, `subscription ${id}`);
    }
    desktop.push({ id: VISIBLE, role: "button", kind: "changed" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const events = c.seen.filter((line) => line.type === "event").map((line) => line.event as ChangeEvent);
    // Three watches, three events, in the order the watches were opened:
    // priority is a label the daemon carries for the agent layer. Nothing in
    // the daemon reads it - a high-priority watch is not delivered first, more
    // often, or differently.
    expect(events.map((event) => event.priority)).toEqual(["low", "medium", "high"]);
    const shapes = events.map(({ priority: _priority, subscriptionId: _subscriptionId, at: _at, ...rest }) => rest);
    expect(shapes).toEqual([shapes[0], shapes[0], shapes[0]]);
  });
});

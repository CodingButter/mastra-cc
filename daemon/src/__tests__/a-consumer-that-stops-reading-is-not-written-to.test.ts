// A CONSUMER THAT STOPS READING IS NOT WRITTEN TO (ADR-0106).
//
// The CC-09 measurement found the daemon's retained queue toward a watch
// consumer is Node's socket buffer, growing ~124 B an event with no bound and
// nothing deciding. The decision: past a bound of unsent bytes the consumer is
// stopped, not slow, and its watches HOLD the newest pointer per element
// (bounded) instead of writing more. When the pipe drains, the held pointers
// are delivered. The watch's own end is never held. A consumer that reads
// never sees any of this.
//
// The first tests drive the book directly with a scripted pressure gauge, so
// the bound and the hold are exact. The last one uses a real Unix socket and a
// client that genuinely stops reading, so the gauge is Node's own.

import { createServer, connect, type Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangeEvent } from "@mastra-cc/protocol-types";
import { SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import { type Backend, type BackendChange, mintSubscriptionId } from "../backend.js";
import { type LaunchContext, startServer, STALLED_CONSUMER_PENDING_BYTES, STALLED_CONSUMER_POINTERS, SubscriptionBook } from "../server.js";
import { OwnershipTable } from "../launch/table.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";
import { observeOnlyEffects } from "./support/observe-only.js";

const root = "el-0123456789ab";
const other = "el-fedcba987654";

function scripted() {
  let sink: (change: BackendChange) => void = () => {};
  const close = vi.fn(async () => {});
  const backend: Backend = {
    ...observeOnlyEffects, name: "stalled-consumer", applicationOfElement: () => "test-app",
    queryElements: async () => ({ elements: [] }),
    attestElement: async () => { throw new Error("unused"); },
    readElementContent: async () => ({ content: { kind: "unavailable", reason: "not-exposed" } }),
    subscribeElement: async (_id, s) => { sink = s; return { subscriptionId: mintSubscriptionId(), application: "test-app", close }; },
    unsubscribeElement: async () => {}, close: async () => {},
  };
  return { backend, emit: (change: BackendChange) => sink(change), close };
}

function gauge() {
  let pending = 0;
  const drains: Array<() => void> = [];
  return {
    pressure: { pending: () => pending, onDrain: (h: () => void) => { drains.push(h); } },
    fill: () => { pending = STALLED_CONSUMER_PENDING_BYTES + 1; },
    drain: () => { pending = 0; for (const h of drains) h(); },
  };
}

describe("the book with a scripted gauge", () => {
  it("writes every change while the pipe is under the bound, and holds the newest per element once it is over", async () => {
    const world = scripted();
    const g = gauge();
    const events: ChangeEvent[] = [];
    const book = new SubscriptionBook((e) => events.push(e), "all", g.pressure);
    await book.subscribe(world.backend, root, "high");
    world.emit({ id: root, role: "textbox", kind: "changed" });
    expect(events).toHaveLength(1);

    g.fill();
    world.emit({ id: root, role: "textbox", kind: "changed" });
    world.emit({ id: other, role: "button", kind: "appeared" });
    world.emit({ id: root, role: "textbox", kind: "changed" });
    expect(events).toHaveLength(1);

    g.drain();
    expect(events.slice(1).map((e) => [e.id, e.kind])).toEqual([[other, "appeared"], [root, "changed"]]);
    // Released, not stuck: the next change under the bound is written at once.
    world.emit({ id: other, role: "button", kind: "changed" });
    expect(events).toHaveLength(4);
    await book.closeAll();
  });

  it("keeps at most the newest N distinct elements while stalled, forgetting the oldest", async () => {
    const world = scripted();
    const g = gauge();
    const events: ChangeEvent[] = [];
    const book = new SubscriptionBook((e) => events.push(e), "all", g.pressure);
    await book.subscribe(world.backend, root, "high");
    g.fill();
    const ids = Array.from({ length: STALLED_CONSUMER_POINTERS + 3 }, (_, i) => `el-${i.toString(16).padStart(12, "0")}`);
    for (const id of ids) world.emit({ id, role: "button", kind: "changed" });
    g.drain();
    expect(events.map((e) => e.id)).toEqual(ids.slice(3));
    await book.closeAll();
  });

  it("never holds the watch's own end, and forgets what it held for a watch that ended", async () => {
    const world = scripted();
    const g = gauge();
    const events: ChangeEvent[] = [];
    const book = new SubscriptionBook((e) => events.push(e), "all", g.pressure);
    await book.subscribe(world.backend, root, "high");
    g.fill();
    world.emit({ id: other, role: "button", kind: "changed" });
    world.emit({ id: root, role: "textbox", kind: "watchEnded" });
    expect(events.map((e) => e.kind)).toEqual(["watchEnded"]);
    expect(world.close).toHaveBeenCalledTimes(1);
    g.drain();
    // The held pointer for a dead watch is not delivered: the watch said it
    // ended, and a change after its end would contradict that.
    expect(events).toHaveLength(1);
    await book.closeAll();
  });

  it("a book with no gauge holds nothing, ever", async () => {
    const world = scripted();
    const events: ChangeEvent[] = [];
    const book = new SubscriptionBook((e) => events.push(e));
    await book.subscribe(world.backend, root, "high");
    for (let i = 0; i < 3000; i++) world.emit({ id: root, role: "textbox", kind: "changed" });
    expect(events).toHaveLength(3000);
    await book.closeAll();
  });
});

describe("over a real Unix socket", () => {
  const dirs: string[] = [];
  const sockets: Socket[] = [];
  afterEach(async () => {
    for (const s of sockets.splice(0)) s.destroy();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("a client that stops reading bounds what the daemon retains, and reads the held pointers when it resumes", { timeout: 20000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "stalled-consumer-"));
    dirs.push(dir);
    const socketPath = join(dir, "d.sock");
    const world = scripted();
    const launch: LaunchContext = { permits: new Set(), allows: new Set(["observe"]), keys: { route: "test" }, catalog: DEFANGED_CATALOG, table: new OwnershipTable(), visibility: "all" };
    const server = await startServer({ socketPath, backend: world.backend, launch });
    try {
      const servedSocket = new Promise<Socket>((r) => server.once("connection", r));
      const client = connect(socketPath);
      sockets.push(client);
      const served = await servedSocket;
      sockets.push(served);
      let text = "";
      const lines = (): string[] => text.split("\n").filter(Boolean);
      client.on("data", (c: Buffer) => { text += c.toString("utf8"); });
      await new Promise<void>((r) => client.once("connect", r));
      client.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
      client.write(`${JSON.stringify({ type: "request", id: 1, method: "subscribeElement", params: { id: root, priority: "high" } })}\n`);
      await vi.waitFor(() => { expect(lines().some((l) => l.includes('"subscriptionId"'))).toBe(true); });

      client.pause();
      // Well past the bound: at ~124 B an event retained, 8000 events is ~1 MB
      // if nothing decided. Bursts per turn, like the CC-09 measurement.
      for (let i = 0; i < 8000; i++) {
        world.emit({ id: i % 2 === 0 ? root : other, role: "textbox", kind: "changed" });
        if (i % 100 === 99) await sleep(0);
      }
      await sleep(50);
      const retained = served.writableLength;
      // Retained bytes stopped at the bound (plus at most the one line that
      // crossed it), rather than growing to the ~1 MB of what was emitted.
      expect(retained).toBeLessThan(STALLED_CONSUMER_PENDING_BYTES + 512);
      expect(retained).toBeGreaterThan(0);

      client.resume();
      await vi.waitFor(() => { expect(served.writableLength).toBe(0); }, { timeout: 5000 });
      await sleep(50);
      const events = lines().filter((l) => l.includes('"type":"event"'));
      // Every held pointer arrived after the drain - one per distinct element.
      const tail = events.slice(-2).map((l) => JSON.parse(l).event.id);
      expect(new Set(tail)).toEqual(new Set([root, other]));
      expect(events.length).toBeLessThan(8000);
      // And the next change is written straight away.
      world.emit({ id: root, role: "textbox", kind: "changed" });
      await vi.waitFor(() => { expect(lines().filter((l) => l.includes('"type":"event"'))).toHaveLength(events.length + 1); });
    } finally {
      for (const s of sockets.splice(0)) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

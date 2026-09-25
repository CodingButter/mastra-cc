// ANSWERS WAIT FOR A READER (ADR-0106 amendment).
//
// Events were held to the stalled-consumer bound, but answers to requests went
// straight to the socket: a client that pipelines large reads and never reads
// the answers made the daemon buffer all of them. An answer cannot be dropped
// or coalesced, so the bound is kept on the request side - while the peer is
// over the bound (or has MAX_IN_FLIGHT_REQUESTS unanswered) nothing more is
// dispatched and the peer is not read. When it reads again, every answer
// arrives, in order.

import { connect, type Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import type { Backend } from "../backend.js";
import { type LaunchContext, MAX_IN_FLIGHT_REQUESTS, startServer, STALLED_CONSUMER_PENDING_BYTES } from "../server.js";
import { OwnershipTable } from "../launch/table.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";
import { observeOnlyEffects } from "./support/observe-only.js";

const ANSWER_CHARS = 16 * 1024;
const REQUESTS = 3000;

const backend: Backend = {
  ...observeOnlyEffects, name: "large-answers", applicationOfElement: () => "test-app",
  queryElements: async () => ({ elements: [] }),
  attestElement: async () => { throw new Error("unused"); },
  readElementContent: async () => ({ content: { kind: "text", value: "x".repeat(ANSWER_CHARS) } }),
  subscribeElement: async () => { throw new Error("unused"); },
  unsubscribeElement: async () => {}, close: async () => {},
};

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

it("a client that stops reading bounds the answers the daemon retains, and gets every one in order when it reads", { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "stalled-answers-"));
  dirs.push(dir);
  const socketPath = join(dir, "d.sock");
  const launch: LaunchContext = { permits: new Set(), allows: new Set(["observe"]), keys: { route: "test" }, catalog: DEFANGED_CATALOG, table: new OwnershipTable(), visibility: "all" };
  const server = await startServer({ socketPath, backend, launch });
  const sockets: Socket[] = [];
  try {
    const servedSocket = new Promise<Socket>((r) => server.once("connection", r));
    const client = connect(socketPath);
    sockets.push(client);
    const served = await servedSocket;
    sockets.push(served);
    let text = "";
    client.on("data", (c: Buffer) => { text += c.toString("utf8"); });
    await new Promise<void>((r) => client.once("connect", r));
    client.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
    await vi.waitFor(() => { expect(text).toContain('"type":"hello"'); });

    client.pause();
    for (let id = 1; id <= REQUESTS; id++) {
      client.write(`${JSON.stringify({ type: "request", id, method: "readElementContent", params: { id: "el-0123456789ab" } })}\n`);
    }
    // Let the daemon do all it will do for a client that is not reading.
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      await sleep(25);
      peak = Math.max(peak, served.writableLength);
    }
    // Unbounded, this is ~48 MB. Bounded, it is the pending bound plus at most
    // one round of in-flight answers.
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(STALLED_CONSUMER_PENDING_BYTES + (MAX_IN_FLIGHT_REQUESTS + 1) * (ANSWER_CHARS + 256));

    client.resume();
    await vi.waitFor(() => {
      expect(text.split("\n").filter((l) => l.includes('"type":"response"')).length).toBe(REQUESTS);
    }, { timeout: 20000 });
    const ids = text.split("\n").filter((l) => l.includes('"type":"response"')).map((l) => JSON.parse(l).id as number);
    expect(ids).toEqual(Array.from({ length: REQUESTS }, (_, i) => i + 1));
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

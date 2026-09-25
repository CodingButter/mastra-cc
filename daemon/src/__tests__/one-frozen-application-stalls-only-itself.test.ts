// ONE FROZEN APPLICATION STALLS ONLY ITSELF (C3, the global chain).
//
// Every backend call used to wait in one daemon-wide queue, so an application
// that stopped answering held every client until its deadline. Calls now queue
// per target: the same application stays one-at-a-time and in order, other
// applications and unscoped calls are not held behind it, and one
// connection's requests still run in the order it sent them.

import { connect, type Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import type { Backend } from "../backend.js";
import { type LaunchContext, queuedTargets, startServer } from "../server.js";
import { OwnershipTable } from "../launch/table.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";
import { observeOnlyEffects } from "./support/observe-only.js";

const FROZEN = "el-aaaaaaaaaaaa";
const FROZEN_TOO = "el-aaaaaaaaaaab";
const LIVE = "el-bbbbbbbbbbbb";

let thaw: () => void = () => {};
let frozen = new Promise<void>((r) => { thaw = r; });
const reads: string[] = [];

const backend: Backend = {
  ...observeOnlyEffects, name: "one-frozen",
  applicationOfElement: (id: string) => (id.startsWith("el-aaaa") ? "frozen-app" : "live-app"),
  queryElements: async () => ({ elements: [] }),
  attestElement: async () => { throw new Error("unused"); },
  readElementContent: async ({ id }: { id: string }) => {
    reads.push(`start ${id}`);
    if (id.startsWith("el-aaaa")) await frozen;
    reads.push(`end ${id}`);
    return { content: { kind: "text", value: id } };
  },
  subscribeElement: async () => { throw new Error("unused"); },
  unsubscribeElement: async () => {}, close: async () => {},
} as unknown as Backend;

const dirs: string[] = [];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  thaw();
  for (const c of cleanups.splice(0)) await c();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  frozen = new Promise<void>((r) => { thaw = r; });
  reads.length = 0;
});

async function daemon() {
  const dir = mkdtempSync(join(tmpdir(), "per-target-"));
  dirs.push(dir);
  const socketPath = join(dir, "d.sock");
  const launch: LaunchContext = { permits: new Set(), allows: new Set(["observe"]), keys: { route: "test" }, catalog: DEFANGED_CATALOG, table: new OwnershipTable(), visibility: "all" };
  const server = await startServer({ socketPath, backend, launch });
  const sockets: Socket[] = [];
  cleanups.push(async () => {
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  });
  let next = 1;
  return async function client() {
    const socket = connect(socketPath);
    sockets.push(socket);
    let text = "";
    const answers = new Map<number, { at: number; line: string }>();
    socket.on("data", (c: Buffer) => {
      text += c.toString("utf8");
      let i;
      while ((i = text.indexOf("\n")) >= 0) {
        const line = text.slice(0, i);
        text = text.slice(i + 1);
        const m = JSON.parse(line) as { type: string; id?: number };
        if (m.type === "response" && m.id !== undefined) answers.set(m.id, { at: performance.now(), line });
      }
    });
    await new Promise<void>((r) => socket.once("connect", r));
    socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
    await new Promise((r) => setTimeout(r, 30));
    return {
      send(method: string, params: unknown): number {
        const id = next++;
        socket.write(`${JSON.stringify({ type: "request", id, method, params })}\n`);
        return id;
      },
      answers,
    };
  };
}

it("answers a second client about another application while one application is frozen", async () => {
  const client = await daemon();
  const a = await client();
  const b = await client();
  const stuck = a.send("readElementContent", { id: FROZEN });
  await vi.waitFor(() => expect(reads).toContain(`start ${FROZEN}`));

  const sent = performance.now();
  const other = b.send("readElementContent", { id: LIVE });
  await vi.waitFor(() => expect(b.answers.has(other)).toBe(true), { timeout: 2000 });
  expect(b.answers.get(other)!.at - sent).toBeLessThan(500);
  expect(a.answers.has(stuck)).toBe(false);

  thaw();
  await vi.waitFor(() => expect(a.answers.has(stuck)).toBe(true));
});

it("keeps one application's calls one at a time, in arrival order", async () => {
  const client = await daemon();
  const a = await client();
  const b = await client();
  a.send("readElementContent", { id: FROZEN });
  await vi.waitFor(() => expect(reads).toContain(`start ${FROZEN}`));
  const second = b.send("readElementContent", { id: FROZEN_TOO });
  await new Promise((r) => setTimeout(r, 100));
  // the same application's second call has not started while the first runs
  expect(reads).not.toContain(`start ${FROZEN_TOO}`);
  expect(b.answers.has(second)).toBe(false);

  thaw();
  await vi.waitFor(() => expect(b.answers.has(second)).toBe(true));
  expect(reads).toEqual([`start ${FROZEN}`, `end ${FROZEN}`, `start ${FROZEN_TOO}`, `end ${FROZEN_TOO}`]);
});

it("does not hold an unscoped call behind one frozen application", async () => {
  const client = await daemon();
  const a = await client();
  const b = await client();
  a.send("readElementContent", { id: FROZEN });
  await vi.waitFor(() => expect(reads).toContain(`start ${FROZEN}`));
  const query = b.send("queryElements", {});
  await vi.waitFor(() => expect(b.answers.has(query)).toBe(true), { timeout: 2000 });
});

it("keeps one connection's requests in the order it sent them, even across applications", async () => {
  const client = await daemon();
  const a = await client();
  const first = a.send("readElementContent", { id: FROZEN });
  const second = a.send("readElementContent", { id: LIVE });
  await new Promise((r) => setTimeout(r, 100));
  expect(reads).toEqual([`start ${FROZEN}`]);
  expect(a.answers.has(second)).toBe(false);

  thaw();
  await vi.waitFor(() => expect(a.answers.has(second)).toBe(true));
  expect(a.answers.get(first)!.at).toBeLessThanOrEqual(a.answers.get(second)!.at);
  expect(reads).toEqual([`start ${FROZEN}`, `end ${FROZEN}`, `start ${LIVE}`, `end ${LIVE}`]);
});

it("forgets a target's queue once nothing waits in it", async () => {
  const client = await daemon();
  const a = await client();
  thaw();
  const id = a.send("readElementContent", { id: LIVE });
  await vi.waitFor(() => expect(a.answers.has(id)).toBe(true));
  await vi.waitFor(() => expect(queuedTargets()).toBe(0));
});

it("never runs two effects at once, even on different applications", async () => {
  const dir = mkdtempSync(join(tmpdir(), "per-target-fx-"));
  dirs.push(dir);
  let running = 0, peak = 0;
  const effects: string[] = [];
  const fx = {
    ...backend,
    typeText: async (params: { id: string; text: string }) => {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 40));
      effects.push(params.text);
      running--;
      return { element: { id: params.id, role: "textbox", name: "f", actions: [], states: [], content: { kind: "text", value: params.text } } };
    },
  } as unknown as Backend;
  const socketPath = join(dir, "d.sock");
  const launch: LaunchContext = { permits: new Set(), allows: new Set(["rawInput"]), keys: { route: "test" }, catalog: DEFANGED_CATALOG, table: new OwnershipTable(), visibility: "all" };
  const server = await startServer({ socketPath, backend: fx, launch });
  const socket = connect(socketPath);
  cleanups.push(async () => { socket.destroy(); await new Promise<void>((r) => server.close(() => r())); });
  let text = "";
  socket.on("data", (c: Buffer) => { text += c.toString("utf8"); });
  await new Promise<void>((r) => socket.once("connect", r));
  socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
  const targets = [FROZEN, LIVE, FROZEN_TOO, LIVE];
  targets.forEach((id, i) => socket.write(`${JSON.stringify({ type: "request", id: i + 1, method: "typeText", params: { id, text: `t${i}` } })}\n`));
  await vi.waitFor(() => expect(text.split("\n").filter((l) => l.includes('"type":"response"')).length).toBe(4), { timeout: 3000 });
  expect(peak).toBe(1);
  expect(effects).toEqual(["t0", "t1", "t2", "t3"]);
});

import { expect, it, vi } from "vitest";
import type { ChangeEvent } from "@mastra-cc/protocol-types";
import { type Backend, type BackendChange, mintSubscriptionId } from "../backend.js";
import { handleRequest, SubscriptionBook } from "../server.js";
import { OwnershipTable } from "../launch/table.js";
import { observeOnlyEffects } from "./support/observe-only.js";

const id = "el-0123456789ab";
const change: BackendChange = { id, role: "textbox", kind: "changed" };
function fixture(count: number) {
  const close = vi.fn(async () => {});
  const events: ChangeEvent[] = [];
  const backend: Backend = {
    ...observeOnlyEffects, name: "initializing-watch", applicationOfElement: () => "test-app",
    queryElements: async () => ({ elements: [] }),
    attestElement: async () => { throw new Error("unused"); },
    readElementContent: async () => ({ content: { kind: "unavailable", reason: "not-exposed" } }),
    subscribeElement: async (_id, sink) => {
      for (let index = 0; index < count; index++) sink(change);
      await Promise.resolve();
      return { subscriptionId: mintSubscriptionId(), application: "test-app", close };
    },
    unsubscribeElement: async () => {}, close: async () => {},
  };
  const book = new SubscriptionBook(event => events.push(event));
  const subscribe = () => handleRequest({ type: "request", id: 1, method: "subscribeElement", params: { id, priority: "high" } }, backend,
    { permits: new Set(), catalog: {}, table: new OwnershipTable(), allows: new Set(["observe"]), visibility: "all" }, book);
  return { close, events, book, subscribe, backend };
}

it("delivers changes emitted before backend subscription resolution through public dispatch", async () => {
  const world = fixture(2);
  try {
    const response = await world.subscribe();
    expect(response.refusal).toBeUndefined();
    expect(world.events).toHaveLength(2);
    expect(world.events.every(event => event.id === id && event.priority === "high")).toBe(true);
  } finally { await world.book.closeAll(); }
});

it("accepts exactly 256 initialization pointers", async () => {
  const world = fixture(256);
  try {
    expect((await world.subscribe()).refusal).toBeUndefined();
    expect(world.events).toHaveLength(256);
  } finally { await world.book.closeAll(); }
});

it("closes a subscription that finishes initialization after connection teardown", async () => {
  const world = fixture(1);
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  world.backend.subscribeElement = async (_id, sink) => {
    sink(change);
    await ready;
    sink(change);
    return { subscriptionId: mintSubscriptionId(), application: "test-app", close: world.close };
  };
  const pending = world.book.subscribe(world.backend, id, "high");
  await world.book.closeAll();
  finish();
  await expect(pending).rejects.toThrow("closed during initialization");
  expect(world.close).toHaveBeenCalledTimes(1);
  expect(world.events).toHaveLength(0);
  expect(world.book.size).toBe(0);
  await expect(world.book.subscribe(world.backend, id, "high")).rejects.toThrow("closed");
});

it("does not disclose hidden-application initialization pointers", async () => {
  const world = fixture(2);
  const book = new SubscriptionBook(event => world.events.push(event), new Set());
  try {
    await book.subscribe(world.backend, id, "high");
    expect(world.events).toHaveLength(0);
  } finally { await book.closeAll(); }
});

it("keeps the existing ended-watch tombstone contract without delivering later changes", async () => {
  const world = fixture(0);
  world.backend.subscribeElement = async (_id, sink) => {
    sink({ ...change, kind: "watchEnded" });
    sink(change);
    return { subscriptionId: mintSubscriptionId(), application: "test-app", close: world.close };
  };
  const subscriptionId = await world.book.subscribe(world.backend, id, "high");
  expect(world.events.map(event => event.kind)).toEqual(["watchEnded"]);
  expect(world.close).toHaveBeenCalledTimes(1);
  expect(await world.book.end(subscriptionId)).toBe(false);
  expect(world.book.size).toBe(0);
});

it("reports overflow cleanup failure as a public refusal without accepting a watch", async () => {
  const world = fixture(257);
  world.close.mockRejectedValueOnce(new Error("close failed"));
  expect((await world.subscribe()).refusal).toBeDefined();
  expect(world.book.size).toBe(0);
  expect(world.events).toHaveLength(0);
});

it("refuses initialization overflow and closes the backend instead of accepting lost events", async () => {
  const world = fixture(257);
  try {
    const response = await world.subscribe();
    expect(response.refusal).toBeDefined();
    expect(world.close).toHaveBeenCalledTimes(1);
    expect(world.events).toHaveLength(0);
    expect(world.book.size).toBe(0);
  } finally { await world.book.closeAll(); }
});

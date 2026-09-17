import { expect, it } from "vitest";
import type { ChangeEvent } from "@mastra-cc/protocol-types";
import { type Backend, type BackendChange, mintSubscriptionId } from "../backend.js";
import { handleRequest, SubscriptionBook } from "../server.js";
import { OwnershipTable } from "../launch/table.js";
import { observeOnlyEffects } from "./support/observe-only.js";

it("keeps origin unknown during, after and across independent desktop operations without dropping pointers", async () => {
  const sinks: ((change: BackendChange) => void)[] = [];
  const events: ChangeEvent[][] = [[], [], []];
  const element = { id: "el-0123456789ab", role: "textbox" as const, name: "field", actions: [], states: [], content: { kind: "unavailable" as const, reason: "not-exposed" as const } };
  const emit = () => { for (const sink of sinks) sink({ id: element.id, role: "textbox", kind: "changed" }); };
  const backend: Backend = {
    ...observeOnlyEffects, name: "first-desktop", applicationOfElement: () => "test-app",
    queryElements: async () => ({ elements: [element] }), attestElement: async () => ({ element }),
    readElementContent: async () => ({ content: element.content }),
    subscribeElement: async (_id, sink) => { sinks.push(sink); return { subscriptionId: mintSubscriptionId(), application: "test-app", close: async () => {} }; },
    unsubscribeElement: async () => {}, close: async () => {},
    editElement: async () => { emit(); return { element }; },
  };
  const other: Backend = { ...backend, name: "independent-desktop" };
  const books = events.map(list => new SubscriptionBook(event => list.push(event)));
  try {
    await books[0].subscribe(backend, element.id, "high");
    await books[1].subscribe(backend, element.id, "high");
    await books[2].subscribe(other, element.id, "high");
    emit();
    const answer = await handleRequest({ type: "request", id: 1, method: "editElement", params: { id: element.id, value: "changed" } }, backend,
      { permits: new Set(), catalog: {}, table: new OwnershipTable(), allows: new Set(["edit"]), visibility: "all" });
    expect(answer.refusal).toBeUndefined();
    emit();
    for (const list of events) {
      expect(list).toHaveLength(3);
      expect(list.map(event => event.attribution)).toEqual(["unattributed", "unattributed", "unattributed"]);
      expect(list.every(event => event.causeId === undefined)).toBe(true);
      expect(list.every(event => event.id === element.id && event.kind === "changed")).toBe(true);
    }
  } finally { await Promise.all(books.map(book => book.closeAll())); }
});

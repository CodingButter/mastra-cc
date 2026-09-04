import { describe, expect, it } from "vitest";
import type { CdpChannel, CdpExchange } from "../channel.js";
import { CdpBackend } from "../index.js";

function channelWith(targets: unknown[]) {
  const exchanges: CdpExchange[] = [];
  const channel: CdpChannel = {
    async exchange(exchange) {
      exchanges.push(exchange);
      if (exchange.kind === "version") {
        return { Browser: "Chrome/150.0.0.0", webSocketDebuggerUrl: "ws://browser" };
      }
      if (exchange.kind === "list") return targets;
      if (exchange.method === "Accessibility.enable") return {};
      if (exchange.method === "Accessibility.getFullAXTree") {
        return {
          result: {
            nodes: [
              {
                nodeId: `${exchange.targetId}-root`,
                backendDOMNodeId: exchange.targetId === "inbox" ? 1 : 2,
                role: { value: "button" },
                name: { value: exchange.targetId },
                properties: [],
              },
            ],
          },
        };
      }
      throw new Error(`unexpected exchange: ${JSON.stringify(exchange)}`);
    },
    async watch() {
      throw new Error("not used");
    },
    async close() {},
  };
  return { channel, exchanges };
}

describe("scoped browser queries", () => {
  it("discovers vocabulary without minting actionable browser IDs", async () => {
    const { channel } = channelWith([{ id: "inbox", type: "page", title: "Inbox" }]);
    const backend = new CdpBackend(channel, "all");

    await expect(backend.discoverElements({ application: "chrome", window: "Inbox" })).resolves.toEqual({
      entries: [{ role: "button", name: "inbox", count: 1, actions: [], operations: ["reveal", "setCaret", "setText", "setValue"] }],
      truncated: false,
      auditApplication: "chrome",
    });

    expect((backend as unknown as { answered: Map<string, unknown> }).answered.size).toBe(0);
    expect((backend as unknown as { mintedByNode: Map<string, unknown> }).mintedByNode.size).toBe(0);
    expect((backend as unknown as { applicationOf: Map<string, unknown> }).applicationOf.size).toBe(0);
  });

  it("discovers nothing in a browser this session was never granted, and reads no page for it", async () => {
    const { channel, exchanges } = channelWith([{ id: "inbox", type: "page", title: "Inbox" }]);
    const backend = new CdpBackend(channel, new Set(["kate"]));

    await expect(backend.discoverElements({ application: "chrome" })).resolves.toEqual({ entries: [], truncated: false });
    expect(exchanges.some((exchange) => exchange.kind === "call")).toBe(false);
  });

  it("discovers nothing when two pages answer to the same window name", async () => {
    const { channel, exchanges } = channelWith([
      { id: "inbox", type: "page", title: "Inbox" },
      { id: "other", type: "page", title: "Inbox" },
    ]);
    const backend = new CdpBackend(channel, "all");

    await expect(backend.discoverElements({ application: "chrome", window: "Inbox" })).resolves.toEqual({
      entries: [],
      truncated: false,
    });
    expect(exchanges.some((exchange) => exchange.kind === "call")).toBe(false);
  });

  it("returns nothing for an application selector outside the granted browser identity", async () => {
    const { channel, exchanges } = channelWith([{ id: "inbox", type: "page", title: "Inbox" }]);
    const backend = new CdpBackend(channel, "all");

    await expect(backend.queryElements({ application: "Firefox" })).resolves.toEqual({ elements: [] });
    expect(exchanges).toEqual([{ kind: "version" }]);
  });

  it("walks only the uniquely named top-level page and excludes same-title iframes", async () => {
    const { channel, exchanges } = channelWith([
      { id: "inbox", type: "page", title: "Inbox" },
      { id: "archive", type: "page", title: "Archive" },
      { id: "frame", type: "iframe", title: "Inbox" },
      { id: "worker", type: "service_worker", title: "Inbox" },
    ]);
    const backend = new CdpBackend(channel, "all");

    const { elements } = await backend.queryElements({ application: "chrome", window: "Inbox", role: "button" });

    expect(elements.map((element) => element.name)).toEqual(["inbox"]);
    expect(exchanges.filter((exchange) => exchange.kind === "call").every((exchange) => exchange.targetId === "inbox")).toBe(true);
  });

  it("returns nothing when a top-level page title is ambiguous", async () => {
    const { channel, exchanges } = channelWith([
      { id: "one", type: "page", title: "Inbox" },
      { id: "two", type: "page", title: "Inbox" },
    ]);
    const backend = new CdpBackend(channel, "all");

    await expect(backend.queryElements({ application: "Chrome", window: "Inbox" })).resolves.toEqual({ elements: [] });
    expect(exchanges.filter((exchange) => exchange.kind === "call")).toEqual([]);
  });
});

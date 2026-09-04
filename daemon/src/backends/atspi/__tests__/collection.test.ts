import { describe, expect, it } from "vitest";
import type { Channel, Exchange } from "../channel.js";
import { UnrecordedExchangeError } from "../channel.js";
import { AtspiBackend } from "../index.js";

// One query tool, one response shape, two instruments. These tests pin that
// the caller cannot tell which instrument answered, that an application which
// does not advertise the fast one is still answered completely by the walk,
// and that a question the bus's role vocabulary cannot carry takes the walk.

const REGISTRY = "org.a11y.atspi.Registry";
const APP = { busName: ":1.7", objectPath: "/org/a11y/atspi/accessible/root" };
const ENTRY = "/org/a11y/atspi/accessible/42";
const BUTTON = "/org/a11y/atspi/accessible/43";

interface Desk {
  collection: boolean;
}

// A tiny scripted desktop: one application with one entry and one button. The
// walk reaches both through GetChildren; the fast path reaches the entry
// through one GetMatches.
function desktop(desk: Desk): Channel & { asked: Exchange[] } {
  const asked: Exchange[] = [];
  const roleOf: Record<string, string> = { [ENTRY]: "entry", [BUTTON]: "push button" };
  return {
    asked,
    async call(exchange) {
      asked.push(exchange);
      const { member, path, destination } = exchange;
      if (member === "GetChildren") {
        if (destination === REGISTRY) return [[[APP.busName, APP.objectPath]]];
        if (path === APP.objectPath) {
          return [[
            [APP.busName, ENTRY],
            [APP.busName, BUTTON],
          ]];
        }
        return [[]];
      }
      if (member === "Get") return [["s", ["scripted-app"]]];
      if (member === "GetRoleName") return [path === APP.objectPath ? "application" : (roleOf[path] ?? "generic")];
      if (member === "GetState") return [[0, 0]];
      if (member === "GetInterfaces") {
        if (path === APP.objectPath && desk.collection) return [["org.a11y.atspi.Collection"]];
        return [[]];
      }
      if (member === "GetMatches") return [[[APP.busName, ENTRY]]];
      throw new Error(`unexpected ${member}`);
    },
    async watch() {
      throw new Error("not used");
    },
    async close() {},
  };
}

describe("backend-selected AT-SPI search", () => {
  it("discovers through DFS without content reads, Collection, or actionable ID registration", async () => {
    const channel = desktop({ collection: true });
    const backend = new AtspiBackend(channel, "all");

    await expect(backend.discoverElements({ application: "scripted-app" })).resolves.toEqual({
      entries: [
        { role: "application", name: "scripted-app", count: 1, actions: [], operations: ["reveal", "setCaret", "setText", "setValue"] },
        { role: "button", name: "scripted-app", count: 1, actions: [], operations: ["reveal", "setCaret", "setText", "setValue"] },
        { role: "textbox", name: "scripted-app", count: 1, actions: [], operations: ["reveal", "setCaret", "setText", "setValue"] },
      ],
      truncated: false,
      auditApplication: "scripted-app",
    });

    expect(channel.asked.some((exchange) => exchange.member === "GetMatches")).toBe(false);
    expect(channel.asked.some((exchange) => exchange.member === "GetState")).toBe(false);
    expect((backend as unknown as { answered: Map<string, unknown> }).answered.size).toBe(0);
    expect((backend as unknown as { byNative: Map<string, unknown> }).byNative.size).toBe(0);
    expect((backend as unknown as { applicationOf: Map<string, unknown> }).applicationOf.size).toBe(0);
  });

  // Discovery aborts where a query would shrug: a vocabulary that stopped
  // short is indistinguishable from a vocabulary that was complete, so the
  // only honest answer to an unfinished walk is no answer at all.
  it("refuses rather than reporting the vocabulary it managed to reach before the budget ran out", async () => {
    const channel = desktop({ collection: true });
    const backend = new AtspiBackend(channel, "all", { maxDepth: 10, maxNodesPerApp: 2, maxNodesTotal: 10 });

    await expect(backend.discoverElements({ application: "scripted-app" })).rejects.toThrow(/would be partial/);
  });

  it("refuses when an element stops answering part-way through the walk", async () => {
    const channel = desktop({ collection: true });
    const failing: Channel & { asked: Exchange[] } = {
      asked: channel.asked,
      async call(exchange) {
        if (exchange.member === "GetRoleName" && exchange.path === BUTTON) throw new Error("it went away");
        return channel.call(exchange);
      },
      watch: channel.watch,
      close: channel.close,
    };
    const backend = new AtspiBackend(failing, "all");

    await expect(backend.discoverElements({ application: "scripted-app" })).rejects.toThrow(/stopped answering/);
  });

  it("discovers nothing in an application this session was never granted", async () => {
    const channel = desktop({ collection: true });
    const backend = new AtspiBackend(channel, new Set(["some-other-app"]));

    await expect(backend.discoverElements({ application: "scripted-app" })).resolves.toEqual({ entries: [], truncated: false });
    expect(channel.asked.some((exchange) => exchange.path === BUTTON)).toBe(false);
  });

  it("returns nothing for an application selector that does not match, without reading descendants", async () => {
    const channel = desktop({ collection: true });
    const backend = new AtspiBackend(channel, "all");

    await expect(backend.queryElements({ application: "another-app", role: "textbox" })).resolves.toEqual({ elements: [] });

    expect(channel.asked.filter((exchange) => exchange.member === "GetChildren")).toHaveLength(1);
    expect(channel.asked.some((exchange) => exchange.member === "GetMatches")).toBe(false);
  });

  it("selects the matching application before using its Collection instrument", async () => {
    const channel = desktop({ collection: true });
    const backend = new AtspiBackend(channel, "all");

    const { elements } = await backend.queryElements({ application: "SCRIPTED-APP", role: "textbox" });

    expect(elements.map((element) => element.role)).toEqual(["textbox"]);
    expect(channel.asked.some((exchange) => exchange.member === "GetMatches")).toBe(true);
  });

  it("answers a role question through one Collection exchange when the application advertises it", async () => {
    const channel = desktop({ collection: true });
    const backend = new AtspiBackend(channel, "all");

    const { elements } = await backend.queryElements({ role: "textbox" });

    expect(elements.map((element) => element.role)).toEqual(["textbox"]);
    expect(channel.asked.some((exchange) => exchange.member === "GetMatches")).toBe(true);
    // the walk's own instrument was never used on the application subtree
    expect(channel.asked.filter((exchange) => exchange.member === "GetChildren")).toHaveLength(1);
  });

  it("answers the same question identically by walking when Collection is not advertised", async () => {
    const fast = new AtspiBackend(desktop({ collection: true }), "all");
    const walked = desktop({ collection: false });
    const slow = new AtspiBackend(walked, "all");

    const viaCollection = await fast.queryElements({ role: "textbox" });
    const viaWalk = await slow.queryElements({ role: "textbox" });

    expect(viaWalk).toEqual(viaCollection);
    expect(walked.asked.some((exchange) => exchange.member === "GetMatches")).toBe(false);
  });

  it("walks for a role the bus vocabulary cannot carry", async () => {
    const channel = desktop({ collection: true });
    const backend = new AtspiBackend(channel, "all");

    await backend.queryElements({ role: "generic" });

    expect(channel.asked.some((exchange) => exchange.member === "GetMatches")).toBe(false);
  });

  // The bus accepts a malformed rule and answers it - just not the question
  // that was meant. So the wire body itself is pinned, not only the reply.
  it("asks the bus for roles as a bitfield matched by ANY, not as a list of ids", async () => {
    const channel = desktop({ collection: true });
    const backend = new AtspiBackend(channel, "all");

    await backend.queryElements({ role: "textbox" });

    const matches = channel.asked.find((exchange) => exchange.member === "GetMatches");
    const rule = (matches?.body?.[0] ?? []) as unknown[];
    // native ids 40 and 79 as set bits: word 1 bit 8, word 2 bit 15
    expect(rule[4]).toEqual([0, 1 << 8, 1 << 15, 0]);
    expect(rule[5]).toBe(2);
  });

  // Measured against a live GTK application: with 0 in these three positions
  // the bridge answered every role question with an empty list, successfully.
  // 0 is INVALID, not "do not care"; the empty clause has to be matched by
  // MATCH_ALL to be vacuously true.
  it("asks the clauses it does not care about with MATCH_ALL, never the invalid match type", async () => {
    const channel = desktop({ collection: true });
    const backend = new AtspiBackend(channel, "all");

    await backend.queryElements({ role: "textbox" });

    const matches = channel.asked.find((exchange) => exchange.member === "GetMatches");
    const rule = (matches?.body?.[0] ?? []) as unknown[];
    expect([rule[1], rule[3], rule[7]]).toEqual([1, 1, 1]);
  });

  // "no matches" and "that rule did not work" are the same successful empty
  // reply, and the role cross-check has nothing to check when nothing came
  // back. So an empty fast answer buys a walk rather than being reported as a
  // desktop with no such element on it.
  it("walks rather than believing an empty fast answer", async () => {
    const scripted = desktop({ collection: true });
    const channel: Channel & { asked: Exchange[] } = {
      asked: scripted.asked,
      async call(exchange) {
        if (exchange.member === "GetMatches") return [[]];
        return scripted.call(exchange);
      },
      watch: scripted.watch,
      close: scripted.close,
    };
    const backend = new AtspiBackend(channel, "all");

    const { elements } = await backend.queryElements({ role: "textbox" });

    expect(elements.map((element) => element.role)).toEqual(["textbox"]);
    expect(channel.asked.filter((exchange) => exchange.member === "GetChildren").length).toBeGreaterThan(1);
  });

  it("walks for the application role, which Collection would answer without its own root", async () => {
    const channel = desktop({ collection: true });
    const backend = new AtspiBackend(channel, "all");

    const { elements } = await backend.queryElements({ role: "application" });

    expect(elements.map((element) => element.role)).toEqual(["application"]);
    expect(channel.asked.some((exchange) => exchange.member === "GetMatches")).toBe(false);
  });

  it("retires a fast answer that disagrees with the role it was asked for", async () => {
    const scripted = desktop({ collection: true });
    const channel: Channel & { asked: Exchange[] } = {
      asked: scripted.asked,
      async call(exchange) {
        // a rule the bus accepts but reads differently: it answers, wrongly
        if (exchange.member === "GetMatches") return [[[APP.busName, BUTTON]]];
        return scripted.call(exchange);
      },
      watch: scripted.watch,
      close: scripted.close,
    };
    const backend = new AtspiBackend(channel, "all");

    const { elements } = await backend.queryElements({ role: "textbox" });

    expect(elements.map((element) => element.role)).toEqual(["textbox"]);
    expect(channel.asked.filter((exchange) => exchange.member === "GetChildren").length).toBeGreaterThan(1);
  });

  it("walks rather than refusing when a tape never recorded the fast instrument", async () => {
    const recorded = desktop({ collection: true });
    const channel: Channel & { asked: Exchange[] } = {
      asked: recorded.asked,
      async call(exchange) {
        if (exchange.member === "GetMatches") throw new UnrecordedExchangeError("off tape");
        return recorded.call(exchange);
      },
      watch: recorded.watch,
      close: recorded.close,
    };
    const backend = new AtspiBackend(channel, "all");

    const { elements } = await backend.queryElements({ role: "textbox" });

    expect(elements.map((element) => element.role)).toEqual(["textbox"]);
    expect(channel.asked.filter((exchange) => exchange.member === "GetChildren").length).toBeGreaterThan(1);
  });
});

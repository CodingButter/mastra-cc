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

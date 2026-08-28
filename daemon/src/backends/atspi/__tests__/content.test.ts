import { describe, expect, it } from "vitest";
import type { Channel, Exchange } from "../channel.js";
import { readObservableContent } from "../content.js";

const REF = { busName: ":1.0", objectPath: "/org/a11y/atspi/accessible/16" };
const TEXT = "org.a11y.atspi.Text";
const VALUE = "org.a11y.atspi.Value";

function channelWith(reply: (exchange: Exchange) => unknown[]): Channel & { asked: Exchange[] } {
  const asked: Exchange[] = [];
  return {
    asked,
    async call(exchange) {
      asked.push(exchange);
      return reply(exchange);
    },
    async watch() {
      throw new Error("not used");
    },
    async close() {},
  };
}

describe("AT-SPI observable content", () => {
  it("reads ordinary text through the published Text interface", async () => {
    const channel = channelWith((exchange) => {
      if (exchange.member === "GetInterfaces") return [[TEXT]];
      if (exchange.member === "GetText") return ["ordinary content"];
      throw new Error(`unexpected ${exchange.member}`);
    });

    await expect(readObservableContent(channel, REF, "entry")).resolves.toEqual({
      kind: "text",
      value: "ordinary content",
    });
    expect(channel.asked.map((exchange) => exchange.member)).toEqual(["GetInterfaces", "GetText"]);
  });

  it("redacts a protected control before asking for interfaces or content", async () => {
    const channel = channelWith(() => {
      throw new Error("a protected control reached the platform read seam");
    });

    await expect(readObservableContent(channel, REF, "password text")).resolves.toEqual({
      kind: "redacted",
      reason: "protected",
    });
    expect(channel.asked).toEqual([]);
  });

  it("returns unavailable when numeric values are not finite", async () => {
    const channel = channelWith((exchange) => {
      if (exchange.member === "GetInterfaces") return [[VALUE]];
      if (exchange.member === "Get") return [undefined];
      throw new Error(`unexpected ${exchange.member}`);
    });

    await expect(readObservableContent(channel, REF, "slider")).resolves.toEqual({
      kind: "unavailable",
      reason: "unknown",
    });
  });

  it("reads ordinary numeric content and its published range", async () => {
    const values: Record<string, number> = {
      CurrentValue: 73,
      MinimumValue: 0,
      MaximumValue: 100,
      MinimumIncrement: 1,
    };
    const channel = channelWith((exchange) => {
      if (exchange.member === "GetInterfaces") return [[VALUE]];
      if (exchange.member === "Get") return [values[String(exchange.body?.[1])]];
      throw new Error(`unexpected ${exchange.member}`);
    });

    await expect(readObservableContent(channel, REF, "slider")).resolves.toEqual({
      kind: "number",
      value: 73,
      range: { minimum: 0, maximum: 100, step: 1 },
    });
  });
});

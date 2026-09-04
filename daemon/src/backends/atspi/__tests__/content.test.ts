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

function textChannel(value: string): Channel & { asked: Exchange[] } {
  return channelWith((exchange) => {
    if (exchange.member === "GetInterfaces") return [[TEXT]];
    if (exchange.member === "Get" && exchange.body?.[1] === "CharacterCount") return [[...value].length];
    if (exchange.member === "GetText") {
      const [start, end] = exchange.body as [number, number];
      return [[...value].slice(start, end).join("")];
    }
    throw new Error(`unexpected ${exchange.member}`);
  });
}

function getTextRequest(channel: Channel & { asked: Exchange[] }): Exchange {
  const request = channel.asked.find((exchange) => exchange.member === "GetText");
  if (!request) throw new Error("GetText was not called");
  return request;
}

describe("AT-SPI observable content", () => {
  it("reads complete inline text through a bounded Text request", async () => {
    const channel = textChannel("ordinary content");

    await expect(readObservableContent(channel, REF, "entry")).resolves.toEqual({
      kind: "text",
      value: "ordinary content",
    });
    expect(channel.asked.map((exchange) => exchange.member)).toEqual(["GetInterfaces", "Get", "GetText"]);
    expect(getTextRequest(channel).body).toEqual([0, 16]);
  });

  it("fetches only a narrow non-zero window from a large document", async () => {
    const value = `${"x".repeat(5000)}\nsecond line`;
    const channel = textChannel(value);

    await expect(readObservableContent(channel, REF, "document text", 4998, 8)).resolves.toEqual({
      kind: "text-window",
      value: "xx\nsecon",
      offset: 4998,
      length: 8,
      totalLength: 5012,
    });
    expect(getTextRequest(channel).body).toEqual([4998, 5006]);
    expect(getTextRequest(channel).body).not.toEqual([0, -1]);
  });

  it("caps oversized windows at the inline limit", async () => {
    const channel = textChannel("x".repeat(5000));
    const content = await readObservableContent(channel, REF, "document text", 0, 1_000_000);

    expect(content).toMatchObject({ kind: "text-window", offset: 0, length: 4096, totalLength: 5000 });
    expect(getTextRequest(channel).body).toEqual([0, 4096]);
  });

  it("clamps offsets beyond the end and reads an empty range", async () => {
    const channel = textChannel("abcdef");

    await expect(readObservableContent(channel, REF, "entry", 100, 10)).resolves.toEqual({
      kind: "text-window",
      value: "",
      offset: 6,
      length: 0,
      totalLength: 6,
    });
    expect(getTextRequest(channel).body).toEqual([6, 6]);
  });

  it("reads empty text with an empty bounded range", async () => {
    const channel = textChannel("");

    await expect(readObservableContent(channel, REF, "entry")).resolves.toEqual({ kind: "text", value: "" });
    expect(getTextRequest(channel).body).toEqual([0, 0]);
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

  it("returns unavailable when text metadata is invalid", async () => {
    const channel = channelWith((exchange) => {
      if (exchange.member === "GetInterfaces") return [[TEXT]];
      if (exchange.member === "Get") return [undefined];
      throw new Error(`unexpected ${exchange.member}`);
    });

    await expect(readObservableContent(channel, REF, "entry")).resolves.toEqual({ kind: "unavailable", reason: "unknown" });
    expect(channel.asked.map((exchange) => exchange.member)).toEqual(["GetInterfaces", "Get"]);
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

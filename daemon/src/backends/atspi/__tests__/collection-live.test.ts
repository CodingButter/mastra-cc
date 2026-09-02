import { describe, expect, it } from "vitest";
import type { Channel, Exchange } from "../channel.js";
import { liveChannel, UnrecordedExchangeError } from "../channel.js";
import { roleIsCollectable } from "../collection.js";
import { AtspiBackend } from "../index.js";

const LIVE = process.env.MASTRA_CC_LIVE === "1";
const suite = LIVE ? describe : describe.skip;

function withoutCollection(inner: Channel): Channel {
  return {
    async call(exchange: Exchange) {
      if (exchange.member === "GetMatches") throw new UnrecordedExchangeError("fast instrument withheld");
      return inner.call(exchange);
    },
    watch: inner.watch.bind(inner),
    close: inner.close.bind(inner),
  };
}

suite("the Collection fast path on a live accessibility bus", { timeout: 120_000 }, () => {
  it("answers every collectable role exactly as the walk does, having actually asked the bus", async () => {
    const asked: Exchange[] = [];
    const inner = liveChannel();
    const fastChannel: Channel = {
      async call(exchange) {
        asked.push(exchange);
        return inner.call(exchange);
      },
      watch: inner.watch.bind(inner),
      close: inner.close.bind(inner),
    };
    const fast = new AtspiBackend(fastChannel, "all");
    const walk = new AtspiBackend(withoutCollection(liveChannel()), "all");

    const { elements: everything } = await walk.queryElements({});
    expect(everything.length).toBeGreaterThan(0);
    const collectable = [...new Set(everything.map((element) => element.role))].filter(roleIsCollectable);
    expect(collectable.length, "no collectable role on this desktop").toBeGreaterThan(0);

    let answered = 0;
    for (const role of collectable) {
      const viaFast = await fast.queryElements({ role });
      const viaWalk = await walk.queryElements({ role });
      expect(viaFast.elements, `role "${role}"`).toEqual(viaWalk.elements);
      answered += viaFast.elements.length;
    }
    expect(asked.some((exchange) => exchange.member === "GetMatches"), "fast instrument never asked").toBe(true);
    expect(answered, "every collectable role answered empty - parity is vacuous").toBeGreaterThan(0);
    await fast.close();
    await walk.close();
  });
});

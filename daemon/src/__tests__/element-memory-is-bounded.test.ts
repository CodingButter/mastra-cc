import { describe, expect, it } from "vitest";
import type { QueryElementsResult } from "@mastra-cc/protocol-types";
import { AtspiBackend } from "../backends/atspi/index.js";
import { CdpBackend } from "../backends/cdp/index.js";
import { ElementMemory } from "../backends/element-memory.js";
import { replayCdpChannel } from "../backends/cdp/channel.js";
import { replayChannel } from "../backends/replay/index.js";
import { TRAVERSAL_LIMITS } from "../backends/atspi/index.js";

describe("the element memory", () => {
  it("never holds more than its cap", () => {
    const forgotten: string[] = [];
    const memory = new ElementMemory<number>(3, (id) => forgotten.push(id));
    for (let i = 0; i < 10; i++) memory.set(`e${i}`, i);
    expect(memory.size).toBe(3);
    expect(forgotten).toEqual(["e0", "e1", "e2", "e3", "e4", "e5", "e6"]);
    expect(memory.get("e0")).toBeUndefined();
    expect(memory.get("e9")).toBe(9);
  });

  it("forgets the least recently used id, not the oldest answered", () => {
    const memory = new ElementMemory<number>(3, () => {});
    memory.set("a", 1);
    memory.set("b", 2);
    memory.set("c", 3);
    memory.get("a");
    memory.set("d", 4);
    expect(memory.get("a")).toBe(1);
    expect(memory.get("b")).toBeUndefined();
  });
});

const backends = {
  "the accessibility bus": (cap: number) => new AtspiBackend(replayChannel("gtk-dialog"), "all", TRAVERSAL_LIMITS, cap),
  "the browser protocol": (cap: number) => new CdpBackend(replayCdpChannel("chrome-page"), "all", cap),
};

describe.each(Object.entries(backends))("on %s, a forgotten id", (_, make) => {
  it("is refused as unknown and forgets its siblings, while the newest ids still answer", async () => {
    const cap = 2;
    const backend = make(cap);
    try {
      const { elements = [] } = (await backend.queryElements({})) as QueryElementsResult;
      const ids = [...new Set(elements.map((element) => element.id))];
      expect(ids.length).toBeGreaterThan(cap);
      expect((backend as unknown as { answered: ElementMemory<unknown> }).answered.size).toBe(cap);
      const forgotten = ids[0]!;
      expect(backend.applicationOfElement(forgotten)).toBeUndefined();
      const refused = await backend.attestElement({ id: forgotten });
      expect(refused.refusal).toMatch(/forgotten after newer answers/);
      expect(refused.refusalClass).toBe("UnknownElement");
      expect(backend.applicationOfElement(ids.at(-1)!)).toBeDefined();
    } finally {
      await backend.close();
    }
  });
});

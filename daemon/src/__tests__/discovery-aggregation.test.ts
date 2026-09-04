import { describe, expect, it } from "vitest";
import { aggregateDiscovery } from "../discovery.js";

describe("discovery aggregation", () => {
  it("aggregates duplicate vocabulary deterministically and truncates only distinct entries", () => {
    const result = aggregateDiscovery([
      { role: "textbox", name: "Search", actions: ["focus"], operations: ["setText"] },
      { role: "button", name: "Go", actions: ["clickAncestor", "activate"], operations: [] },
      { role: "textbox", name: "Search", actions: ["activate"], operations: ["setCaret", "setText"] },
      { role: "button", name: "", actions: [], operations: [] },
    ], 2);

    expect(result).toEqual({
      entries: [
        { role: "button", name: "", count: 1, actions: [], operations: [] },
        { role: "button", name: "Go", count: 1, actions: ["activate", "clickAncestor"], operations: [] },
      ],
      truncated: true,
    });
  });
});

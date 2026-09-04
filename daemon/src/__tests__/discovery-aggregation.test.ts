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

  // A complete inventory that exactly fills the limit is complete, not
  // truncated: the difference is the whole point of the flag.
  it("calls an inventory that exactly fills the limit complete", () => {
    const result = aggregateDiscovery([
      { role: "button", name: "Go", actions: [], operations: [] },
      { role: "textbox", name: "Search", actions: [], operations: [] },
    ], 2);

    expect(result.truncated).toBe(false);
    expect(result.entries).toHaveLength(2);
  });

  // Every distinct name survives aggregation: a comparator or key bug that
  // silently merged two of them would be invisible to a count-only check.
  it("keeps one entry per distinct name, in code-point order", () => {
    const names = ["Zulu", "alpha", "Alpha", "", "beta"];
    const result = aggregateDiscovery(
      names.map((name) => ({ role: "button", name, actions: [], operations: [] })),
      100,
    );

    expect(result.entries.map((entry) => entry.name)).toEqual(["", "Alpha", "Zulu", "alpha", "beta"]);
    expect(result.entries.every((entry) => entry.count === 1)).toBe(true);
    expect(result.truncated).toBe(false);
  });
});

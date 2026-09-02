import { describe, expect, it } from "vitest";
import type { Channel, Exchange } from "../channel.js";
import { AtspiBackend, TRAVERSAL_LIMITS } from "../index.js";
import { IncompleteObservationError } from "../../../backend.js";

// One deep application must not silence the desk. These tests pin, at unit
// level, the two halves of ADR-0071: a tree far past the caps this backend
// first shipped with (24 deep, 4000 nodes) is walked to completion, and the
// budgets - now a safety net rather than a working limit - still refuse with
// IncompleteObservationError when they ARE met. The production comparisons do
// not change; the tests inject small limits through the constructor seam so a
// scripted channel can reach them.

const REGISTRY = "org.a11y.atspi.Registry";
const ROOT = "/org/a11y/atspi/accessible/root";

// A scripted application: paths are generated on demand from a shape
// function, never pre-materialised, so a chain ten thousand deep costs the
// test nothing until the walk asks for it.
interface Shape {
  name: string;
  // children of a node, by its path (the application root is ROOT)
  kids(path: string): string[];
  // native role name of a node
  role(path: string): string;
}

function desk(apps: Shape[]): Channel & { asked: number } {
  const byBus = new Map<string, Shape>();
  apps.forEach((app, index) => byBus.set(`:1.${index + 10}`, app));
  const channel = {
    asked: 0,
    async call(exchange: Exchange) {
      channel.asked += 1;
      const { member, path, destination } = exchange;
      if (member === "GetChildren") {
        if (destination === REGISTRY) return [[...byBus.keys()].map((bus) => [bus, ROOT])];
        const app = byBus.get(destination) as Shape;
        return [app.kids(path).map((kid) => [destination, kid])];
      }
      const app = byBus.get(destination) as Shape;
      if (member === "Get") return [["s", [app.name]]];
      if (member === "GetRoleName") return [path === ROOT ? "application" : app.role(path)];
      if (member === "GetState") return [[0, 0]];
      if (member === "GetInterfaces") return [[]];
      throw new Error(`unexpected ${member}`);
    },
    async watch(): Promise<never> {
      throw new Error("not used");
    },
    async close() {},
  };
  return channel;
}

// The application root sits at depth 0 (index.ts: the stack starts at
// { ref: app, depth: 0 }). A "spine" node at depth d is /s/d; its leaves are
// /s/d/l/i. The depth check fires on a node at depth >= maxDepth that still
// has children, so a chain must run one level past the cap to trip it.
function spine(name: string, depth: number, leavesPerNode: number): Shape {
  return {
    name,
    kids(path) {
      if (path === ROOT) return ["/s/1"];
      const match = /^\/s\/(\d+)$/.exec(path);
      if (match === null) return [];
      const d = Number(match[1]);
      const kids: string[] = [];
      if (d < depth) kids.push(`/s/${d + 1}`);
      for (let i = 0; i < leavesPerNode; i += 1) kids.push(`/s/${d}/l/${i}`);
      return kids;
    },
    role: (path) => (path.includes("/l/") ? "push button" : "panel"),
  };
}

// A chain: root -> /s/1 -> ... -> /s/depth, no leaves.
const chain = (name: string, depth: number): Shape => spine(name, depth, 0);

// A flat application: root with `count - 1` button children (count nodes in
// total, counting the root).
function flat(name: string, count: number): Shape {
  return {
    name,
    kids: (path) => (path === ROOT ? Array.from({ length: count - 1 }, (_, i) => `/b/${i}`) : []),
    role: () => "push button",
  };
}

const kcalc = (): Shape => flat("kcalc", 10);

describe("a deep application does not silence the desk", () => {
  // T1: 200 spine nodes x (1 spine + 29 leaves) - about 6000 nodes, 200 deep,
  // past BOTH of the caps this backend first shipped with.
  it("walks a tree far deeper and larger than the old caps to completion", async () => {
    const backend = new AtspiBackend(desk([spine("Chromium", 200, 29)]), "all");

    const { elements } = await backend.queryElements({ role: "button" });

    expect(elements).toHaveLength(200 * 29);
    expect(elements.every((element) => element.role === "button")).toBe(true);
  });

  // T2: the other application on the desk is still read while the deep one is open.
  it("still answers for the shallow application beside the deep one", async () => {
    const backend = new AtspiBackend(desk([spine("Chromium", 200, 29), kcalc()]), "all");

    const { elements } = await backend.queryElements({ role: "button" });

    // every element carries the name its application published (the fake
    // answers Name with the application's name), so KCalc's are countable
    expect(elements).toHaveLength(200 * 29 + 9);
    expect(elements.filter((element) => element.name === "kcalc")).toHaveLength(9);
  });

  // T3: the depth net. maxDepth 5: /s/5 sits at depth 5 and, in a chain 6
  // deep, still has a child - so the walk refuses there. A chain 4 deep never
  // reaches depth 5 with children and completes.
  it("still refuses when the depth budget is met above a node with children", async () => {
    const limits = { maxDepth: 5, maxNodesPerApp: 1000, maxNodesTotal: 1000 };

    const deep = new AtspiBackend(desk([chain("deep", 6)]), "all", limits);
    await expect(deep.queryElements({ role: "button" })).rejects.toThrow(IncompleteObservationError);
    await expect(deep.queryElements({ role: "button" })).rejects.toThrow(/depth budget/);

    const shallow = new AtspiBackend(desk([chain("shallow", 4)]), "all", limits);
    await expect(shallow.queryElements({ role: "button" })).resolves.toEqual({ elements: [] });
  });

  // T4: the per-application net. 51 nodes (root + 50 buttons) against a cap of 50.
  it("still refuses when the per-application node budget is met", async () => {
    const limits = { maxDepth: 1000, maxNodesPerApp: 50, maxNodesTotal: 1000 };

    const over = new AtspiBackend(desk([flat("over", 51)]), "all", limits);
    await expect(over.queryElements({ role: "button" })).rejects.toThrow(IncompleteObservationError);
    await expect(over.queryElements({ role: "button" })).rejects.toThrow(/walk budget/);

    const under = new AtspiBackend(desk([flat("under", 49)]), "all", limits);
    const { elements } = await under.queryElements({ role: "button" });
    expect(elements).toHaveLength(48);
  });

  // T5: the total net. Two applications of 45 nodes against a total of 80:
  // the first fits (45 < 50 per app), the second trips the total half of the
  // same check in the walk.
  it("still refuses when the desk-wide node budget is met by the second application", async () => {
    const limits = { maxDepth: 1000, maxNodesPerApp: 1000, maxNodesTotal: 80 };

    const over = new AtspiBackend(desk([flat("a", 45), flat("b", 45)]), "all", limits);
    await expect(over.queryElements({ role: "button" })).rejects.toThrow(IncompleteObservationError);

    const under = new AtspiBackend(desk([flat("a", 30), flat("b", 30)]), "all", limits);
    const { elements } = await under.queryElements({ role: "button" });
    expect(elements).toHaveLength(58);
  });

  // T6: the real depth cap binds. A chain one past TRAVERSAL_LIMITS.maxDepth,
  // generated lazily, refuses under the default limits.
  it("binds at the real depth cap", async () => {
    const backend = new AtspiBackend(desk([chain("bottomless", TRAVERSAL_LIMITS.maxDepth + 1)]), "all");

    await expect(backend.queryElements({ role: "button" })).rejects.toThrow(IncompleteObservationError);
  }, 10_000);

  // T7: the defaults are the constants (wiring pin, not invariant coverage).
  it("uses the recorded limits when none are injected", () => {
    expect(TRAVERSAL_LIMITS).toEqual({ maxDepth: 10_000, maxNodesPerApp: 1_000_000, maxNodesTotal: 5_000_000 });
    expect(new AtspiBackend(desk([kcalc()]), "all").traversalLimits).toEqual(TRAVERSAL_LIMITS);
  });
});

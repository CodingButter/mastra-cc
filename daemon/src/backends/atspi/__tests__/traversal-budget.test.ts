import type { QueryElementsParams } from "@mastra-cc/protocol-types";
import { describe, expect, it } from "vitest";
import type { Channel, Exchange } from "../channel.js";
import { allocationPerApplication, AtspiBackend } from "../index.js";

// A refusal has to be answerable for. These tests pin the two properties that
// make it so: the application named in the refusal is the one that actually
// spent its own allocation, and the same desktop refuses the same way however
// the bus happens to order its children. The share is computed from the
// application COUNT, so order cannot reach it.

const REGISTRY = "org.a11y.atspi.Registry";

interface App {
  name: string;
  width: number;
  collection?: boolean;
}

// Each application is a flat fan of `width` children off its own root, so the
// nodes an application costs is width + 1 (itself) and nothing about the shape
// competes with what is being measured.
function desktop(apps: App[]): Channel & { asked: Exchange[] } {
  const asked: Exchange[] = [];
  const byBus = new Map(apps.map((app, index) => [`:1.${index + 1}`, app]));
  const rootOf = (bus: string) => `/app/${bus}/root`;
  return {
    asked,
    async call(exchange) {
      asked.push(exchange);
      const { member, path, destination } = exchange;
      if (member === "GetChildren") {
        if (destination === REGISTRY) {
          return [[...byBus.keys()].map((bus) => [bus, rootOf(bus)])];
        }
        const app = byBus.get(destination);
        if (app === undefined) return [[]];
        if (path !== rootOf(destination)) return [[]];
        return [
          Array.from({ length: app.width }, (_, index) => [destination, `/app/${destination}/node/${index}`]),
        ];
      }
      if (member === "Get") return [["s", [byBus.get(destination)?.name ?? "unknown"]]];
      if (member === "GetRoleName") return [path === rootOf(destination) ? "application" : "push button"];
      if (member === "GetState") return [[0, 0]];
      if (member === "GetInterfaces") {
        const app = byBus.get(destination);
        if (app?.collection === true && path === rootOf(destination)) return [["org.a11y.atspi.Collection"]];
        return [[]];
      }
      if (member === "GetMatches") {
        const app = byBus.get(destination);
        if (app === undefined) return [[]];
        return [
          Array.from({ length: app.width }, (_, index) => [destination, `/app/${destination}/node/${index}`]),
        ];
      }
      throw new Error(`unexpected ${member}`);
    },
    async watch() {
      throw new Error("not used");
    },
    async close() {},
  };
}

// "generic" by default: a role the bus's own vocabulary cannot carry, so the
// query takes the walk whatever an application advertises. Pass a carryable
// role to reach the fast instrument.
async function refusalOf(apps: App[], role: QueryElementsParams["role"] = "generic"): Promise<string> {
  const backend = new AtspiBackend(desktop(apps), "all");
  try {
    await backend.queryElements({ role });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected the query to refuse, but it answered");
}

// Six applications: each is allocated floor(20000 / 6) = 3333 nodes.
const HEAVY = Array.from({ length: 5 }, (_, index) => ({ name: `heavy-${index}`, width: 3999 }));
const TINY = { name: "tiny-app", width: 2 };

describe("the traversal budget is divided among applications", () => {
  it("never blames a small application for what the applications before it spent", async () => {
    const message = await refusalOf([...HEAVY, TINY]);

    // tiny-app costs three nodes of its own 3333. Before the budget was
    // divided it was named here, having been walked last.
    expect(message).not.toContain("tiny-app");
    expect(message).toContain("heavy-0");
  });

  it("refuses the same way when the bus lists the same applications in a different order", async () => {
    const lastWalked = await refusalOf([...HEAVY, TINY]);
    const firstWalked = await refusalOf([TINY, ...HEAVY]);

    // Same desktop, same query, same refusal. The bus promises no ordering, so
    // this is the property that makes a refusal reproducible at all.
    expect(firstWalked).toEqual(lastWalked);
  });

  it("refuses an application at its own allocation and answers one that fits inside it", async () => {
    const sixth = allocationPerApplication(6);
    expect(sixth).toBe(3333);

    const over = await refusalOf([...HEAVY, { name: "over", width: sixth }]);
    expect(over).toContain("heavy-0");

    const fits = Array.from({ length: 6 }, (_, index) => ({ name: `fits-${index}`, width: sixth - 2 }));
    const backend = new AtspiBackend(desktop(fits), "all");
    await expect(backend.queryElements({ role: "generic" })).resolves.toBeDefined();
  });

  it("derives an application's share from the count alone", () => {
    // Small desktops keep the whole per-application cap...
    expect(allocationPerApplication(1)).toBe(4000);
    expect(allocationPerApplication(5)).toBe(4000);
    expect(allocationPerApplication(10)).toBe(2000);
    // ...and the floor takes over before the share drops under the 1030-node
    // application this backend measured on a real desktop.
    expect(allocationPerApplication(20)).toBe(1200);
    expect(allocationPerApplication(33)).toBe(1200);
  });

  it("refuses a desktop too crowded to observe before reading a single node", async () => {
    const crowded = Array.from({ length: 50 }, (_, index) => ({ name: `app-${index}`, width: 1 }));
    const channel = desktop(crowded);
    const backend = new AtspiBackend(channel, "all");

    await expect(backend.queryElements({ role: "generic" })).rejects.toThrow(/50 applications/);
    // One GetChildren to list the desktop, and nothing else: the refusal is
    // free, and it names the count that caused it.
    expect(channel.asked.filter((exchange) => exchange.member === "GetChildren")).toHaveLength(1);
    expect(channel.asked.some((exchange) => exchange.member === "GetState")).toBe(false);
  });

  it("answers an empty desktop rather than refusing about it", async () => {
    const backend = new AtspiBackend(desktop([]), "all");

    await expect(backend.queryElements({ role: "generic" })).resolves.toEqual({ elements: [] });
  });
});

describe("both instruments spend the same allocation", () => {
  it("refuses a Collection application that would read past its allocation", async () => {
    // Alone on the desktop this application is allocated 4000. Before the fast
    // path was brought under the per-application count it read all 8000,
    // because it only ever consulted the global pool.
    const backend = new AtspiBackend(desktop([{ name: "fast-app", width: 8000, collection: true }]), "all");

    await expect(backend.queryElements({ role: "button" })).rejects.toThrow(/fast-app/);
  });

  it("refuses through either instrument for the same application at the same size", async () => {
    const viaCollection = await refusalOf([{ name: "big", width: 8000, collection: true }], "button");
    const viaWalk = await refusalOf([{ name: "big", width: 8000 }], "button");

    // A caller cannot tell which instrument answered; it should not be able to
    // tell which one refused either, beyond what was left unread.
    for (const message of [viaCollection, viaWalk]) {
      expect(message).toContain('inside "big" after its full allocation of 4000 nodes');
    }
    expect(viaCollection).toContain("matches still unread");
    expect(viaWalk).toContain("its tree unfinished");
  });

  it("still answers by walking when the fast answer is distrusted", async () => {
    // GetMatches here returns push buttons, so a textbox question retires the
    // fast answer. Those reads are kept on the application's allocation, and a
    // small application must still fit comfortably inside it.
    const channel = desktop([{ name: "distrusted", width: 3, collection: true }]);
    const backend = new AtspiBackend(channel, "all");

    const { elements } = await backend.queryElements({ role: "button" });

    expect(channel.asked.some((exchange) => exchange.member === "GetMatches")).toBe(true);
    expect(elements).toHaveLength(3);
  });
});

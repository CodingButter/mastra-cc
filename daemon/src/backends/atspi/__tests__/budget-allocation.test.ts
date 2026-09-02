import { describe, expect, it } from "vitest";
import type { Channel } from "../channel.js";
import { AtspiBackend } from "../index.js";

// The traversal budget is spent per application, not out of one shared pot.
//
// A refusal has to name the application that actually spent the budget, and
// it has to name the same one every time the same desktop is queried. A single
// running total across every application can do neither: it trips inside
// whichever application the bus happened to list when the pot ran dry, so the
// name it reports belongs to a bystander and changes when the bus reorders.
//
// These tests script the bus through the Channel seam - no live AT-SPI.

const REGISTRY = "org.a11y.atspi.Registry";
const ROOT = "/org/a11y/atspi/accessible/root";

interface App {
  name: string;
  width: number;
  collection?: boolean;
  childRole?: string;
}

// Each application is a flat fan of `width` children off its own root. Flat
// keeps the depth budget out of the way, so only the node budget is under test.
function desktop(apps: App[]): Channel {
  const byBus = new Map<string, App>();
  apps.forEach((app, index) => byBus.set(`:1.${100 + index}`, app));

  return {
    async call(exchange) {
      const { member, path, destination, busName } = exchange as {
        member: string;
        path: string;
        destination?: string;
        busName?: string;
      };
      const bus = busName ?? destination ?? "";
      const app = byBus.get(bus);

      if (member === "GetChildren") {
        if (destination === REGISTRY) {
          return [[...byBus.keys()].map((name) => [name, ROOT])];
        }
        if (path === ROOT && app !== undefined) {
          return [
            Array.from({ length: app.width }, (_, index) => [bus, `/org/a11y/atspi/accessible/${index}`]),
          ];
        }
        return [[]];
      }
      if (member === "Get") return [["s", [app?.name ?? "unknown"]]];
      if (member === "GetRoleName") {
        if (path === ROOT) return ["application"];
        return [app?.childRole ?? "generic"];
      }
      if (member === "GetState") return [[0, 0]];
      if (member === "GetInterfaces") {
        if (path === ROOT && app?.collection === true) return [["org.a11y.atspi.Collection"]];
        return [[]];
      }
      if (member === "GetMatches") {
        return [
          Array.from({ length: app?.width ?? 0 }, (_, index) => [bus, `/org/a11y/atspi/accessible/${index}`]),
        ];
      }
      // readElement also asks for actions, magnitudes and content; an empty
      // reply is the "this element publishes nothing" answer.
      return [[]];
    },
    async watch() {
      throw new Error("not used");
    },
    async close() {},
  };
}

// Five applications that each fill the per-application cap, plus one that is
// almost empty. Under a shared pot the pot runs dry during the sixth.
const HEAVY: App[] = Array.from({ length: 5 }, (_, index) => ({ name: `heavy-${index}`, width: 3999 }));
const TINY: App = { name: "tiny-app", width: 2 };

async function refusalFrom(apps: App[]): Promise<string> {
  const backend = new AtspiBackend(desktop(apps), "all");
  try {
    await backend.queryElements({ role: "generic" });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected the query to refuse, but it answered");
}

describe("traversal budget allocation", () => {
  it("names an application that actually spent the budget, not a bystander", async () => {
    // tiny-app contributes 3 of 20000 nodes. It cannot be the cause.
    const message = await refusalFrom([...HEAVY, TINY]);

    expect(message).not.toContain("tiny-app");
    expect(message).toContain("heavy-");
  });

  it("refuses identically when the bus lists the same desktop in a different order", async () => {
    const listedLast = await refusalFrom([...HEAVY, TINY]);
    const listedFirst = await refusalFrom([TINY, ...HEAVY]);

    expect(listedFirst).toBe(listedLast);
  });

  it("holds the fast instrument to the same allowance as the walk", async () => {
    // The walk would refuse this application. Advertising Collection must not
    // buy a larger budget than the walk would have allowed.
    const backend = new AtspiBackend(
      desktop([{ name: "collection-app", width: 8000, collection: true, childRole: "push button" }]),
      "all",
    );

    await expect(backend.queryElements({ role: "button" })).rejects.toThrow(/budget/);
  });

  it("still answers a desktop of ordinary applications", async () => {
    // 1030 nodes is the measured size of the KDE editor the budgets are sized
    // from. Two of them must not become unanswerable to buy attribution.
    const backend = new AtspiBackend(
      desktop([
        { name: "editor", width: 1030 },
        { name: "browser", width: 1030 },
      ]),
      "all",
    );

    const { elements } = await backend.queryElements({ role: "generic" });

    expect(elements.length).toBeGreaterThan(2000);
  });
});

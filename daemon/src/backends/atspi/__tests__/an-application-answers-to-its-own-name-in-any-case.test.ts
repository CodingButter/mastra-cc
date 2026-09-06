import { describe, expect, it } from "vitest";
import type { Channel, Exchange } from "../channel.js";
import { AtspiBackend } from "../index.js";

// AN APPLICATION IS FOUND BY THE NAME EVERYONE ELSE CALLS IT. Chromium
// registers on the accessibility bus as "Chromium" while its desktop entry,
// the operator's permit, the catalog key and every caller say "chromium".
// names.ts already folds case for application names everywhere else - grants,
// permits, ownership, the census - but the query filter did not, so the launch
// path's own lookup (queryElements with role "application" and the requested
// name) walked straight past the browser it had just started and refused the
// launch as unreadable for the whole poll budget (measured 2026-09-05 on the
// demo desk: the window was answering, and openApplication still refused).
//
// Element names stay EXACT. "OK" and "ok" on a screen are two different
// labels, and the second test here is what keeps that true.

const REGISTRY = "org.a11y.atspi.Registry";
const ROOT = "/org/a11y/atspi/accessible/root";
const BUTTON = "/org/a11y/atspi/accessible/button";

function deskWith(applicationName: string, buttonName: string): Channel {
  return {
    async call(exchange: Exchange) {
      const { member, path, destination } = exchange;
      if (member === "GetChildren") {
        if (destination === REGISTRY) return [[[":1.10", ROOT]]];
        return [path === ROOT ? [[":1.10", BUTTON]] : []];
      }
      if (member === "Get") return [["s", [path === BUTTON ? buttonName : applicationName]]];
      if (member === "GetRoleName") return [path === ROOT ? "application" : "push button"];
      if (member === "GetState") return [[0, 0]];
      if (member === "GetInterfaces") return [[]];
      throw new Error(`unexpected ${member}`);
    },
    async watch(): Promise<never> {
      throw new Error("not used");
    },
    async close() {},
  };
}

describe("finding an application by name", () => {
  it("answers for the name the operator uses, whatever case the bus publishes", async () => {
    const backend = new AtspiBackend(deskWith("Chromium", "Reload"), "all");

    const { elements } = await backend.queryElements({ role: "application", name: "chromium" });

    expect(elements.map((element) => element.name)).toEqual(["Chromium"]);
  });

  it("still finds it when the caller is the one shouting", async () => {
    const backend = new AtspiBackend(deskWith("chromium", "Reload"), "all");

    const { elements } = await backend.queryElements({ role: "application", name: "CHROMIUM" });

    expect(elements).toHaveLength(1);
  });

  it("does not fold case for an element's own name - two labels are two labels", async () => {
    const backend = new AtspiBackend(deskWith("Chromium", "Reload"), "all");

    const { elements } = await backend.queryElements({ role: "button", name: "reload" });

    expect(elements).toEqual([]);
  });
});

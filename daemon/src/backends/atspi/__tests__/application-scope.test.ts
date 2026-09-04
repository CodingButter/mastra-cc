import { describe, expect, it } from "vitest";
import type { Channel, Exchange } from "../channel.js";
import { AtspiBackend } from "../index.js";

// ADR-0073: a query can name the one application it means. When the caller
// passes `application`, the answer is restricted to the one application whose
// name matches under the grant normaliser (NFKC + case-fold); absent means
// every visible application, exactly as before. The scope filter runs after the
// visibility gate, so naming an ungranted application is an empty answer, never
// a leak.

const REGISTRY = "org.a11y.atspi.Registry";
const ROOT = "/org/a11y/atspi/accessible/root";

// A flat scripted application: root (role "application") with `count` button
// children, every element answering the application's own name. Mirrors the
// harness in a-deep-application-does-not-silence-the-desk.test.ts.
interface App {
  name: string;
  count: number;
}

function desk(apps: App[], visibility: "all" | Set<string> = "all"): AtspiBackend {
  const byBus = new Map<string, App>();
  apps.forEach((app, index) => byBus.set(`:1.${index + 10}`, app));
  const channel: Channel = {
    async call(exchange: Exchange) {
      const { member, path, destination } = exchange;
      if (member === "GetChildren") {
        if (destination === REGISTRY) return [[...byBus.keys()].map((bus) => [bus, ROOT])];
        const app = byBus.get(destination) as App;
        return [path === ROOT ? Array.from({ length: app.count }, (_, i) => [destination, `/b/${i}`]) : []];
      }
      const app = byBus.get(destination) as App;
      if (member === "Get") return [["s", [app.name]]];
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
  return new AtspiBackend(channel, visibility);
}

describe("a query can name the one application it means", () => {
  it("returns only the named application's elements when two distinct applications are visible", async () => {
    const backend = desk([{ name: "kcalc", count: 3 }, { name: "kate", count: 4 }]);

    const { elements } = await backend.queryElements({ role: "button", application: "kate" });

    expect(elements).toHaveLength(4);
    expect(elements.every((element) => element.name === "kate")).toBe(true);
  });

  it("returns every visible application's elements when no application is named", async () => {
    const backend = desk([{ name: "kcalc", count: 3 }, { name: "kate", count: 4 }]);

    const { elements } = await backend.queryElements({ role: "button" });

    expect(elements).toHaveLength(7);
  });

  it("matches the scope case-insensitively, the way a grant names an application", async () => {
    const backend = desk([{ name: "KCalc", count: 3 }, { name: "kate", count: 4 }]);

    const { elements } = await backend.queryElements({ role: "button", application: "kcalc" });

    expect(elements).toHaveLength(3);
    expect(elements.every((element) => element.name === "KCalc")).toBe(true);
  });

  it("returns an empty answer for an application that is not on the desk - absent, never an error", async () => {
    const backend = desk([{ name: "kcalc", count: 3 }, { name: "kate", count: 4 }]);

    await expect(backend.queryElements({ role: "button", application: "firefox" })).resolves.toEqual({
      elements: [],
    });
  });

  it("returns an empty answer for an ungranted application, running the scope after the visibility gate", async () => {
    // kate is on the desk but not in the granted set: naming it as scope must
    // not surface it (ADR-0036 - an ungranted application is absent).
    const backend = desk([{ name: "kcalc", count: 3 }, { name: "kate", count: 4 }], new Set(["kcalc"]));

    await expect(backend.queryElements({ role: "button", application: "kate" })).resolves.toEqual({
      elements: [],
    });
  });

  it("keeps both applications when the scope names a duplicated application name", async () => {
    // Two applications share a name; the scope names all of them, because the
    // desk cannot tell them apart by name any more than the caller can. The
    // duplicate case is disambiguated by element identity, not by scope.
    const backend = desk([{ name: "kate", count: 2 }, { name: "kate", count: 3 }]);

    const { elements } = await backend.queryElements({ role: "button", application: "kate" });

    expect(elements).toHaveLength(5);
  });
});

import { describe, expect, it } from "vitest";
import { IncompleteObservationError } from "../../../backend.js";
import type { Channel, Exchange } from "../channel.js";
import { AtspiBackend } from "../index.js";

const REGISTRY = "org.a11y.atspi.Registry";
const ROOT = "/org/a11y/atspi/accessible/root";

interface Application {
  name: string;
  nodes: number;
  collection?: boolean;
  matches?: number;
  disagreeAt?: number;
}

function desktop(applications: Application[]): Channel & { asked: Exchange[] } {
  const asked: Exchange[] = [];
  const apps = applications.map((application, index) => ({
    ...application,
    busName: `:1.${index + 1}`,
  }));
  const byBus = new Map(apps.map((application) => [application.busName, application]));

  return {
    asked,
    async call(exchange) {
      asked.push(exchange);
      const { destination, member, path } = exchange;
      const application = byBus.get(destination);

      if (member === "GetChildren") {
        if (destination === REGISTRY) return [apps.map((app) => [app.busName, ROOT])];
        if (application !== undefined && path === ROOT) {
          return [Array.from({ length: Math.max(0, application.nodes - 1) }, (_, index) => [
            application.busName,
            `/node/${index}`,
          ])];
        }
        return [[]];
      }
      if (member === "Get") return [["s", [application?.name ?? "node"]]];
      if (member === "GetRoleName") {
        if (path === ROOT) return ["application"];
        const index = Number(path.split("/").at(-1));
        return [application?.disagreeAt === index + 1 ? "generic" : "push button"];
      }
      if (member === "GetState") return [[0, 0]];
      if (member === "GetInterfaces") {
        return [path === ROOT && application?.collection ? ["org.a11y.atspi.Collection"] : []];
      }
      if (member === "GetMatches") {
        return [Array.from({ length: application?.matches ?? 0 }, (_, index) => [destination, `/node/${index}`])];
      }
      throw new Error(`unexpected ${member}`);
    },
    async watch() {
      throw new Error("not used");
    },
    async close() {},
  };
}

async function refusal(backend: AtspiBackend): Promise<IncompleteObservationError> {
  try {
    await backend.queryElements({ role: "button" });
  } catch (error) {
    expect(error).toBeInstanceOf(IncompleteObservationError);
    return error as IncompleteObservationError;
  }
  throw new Error("expected query to refuse");
}

const heavyDesktop = [
  ...Array.from({ length: 5 }, (_, index) => ({ name: `heavy-${index}`, nodes: 3999 })),
  { name: "tiny-app", nodes: 2 },
];

describe("AT-SPI traversal allocation", () => {
  it("names an application that exceeded its own allowance, not the bystander where the shared pool ended", async () => {
    const error = await refusal(new AtspiBackend(desktop(heavyDesktop), "all"));
    expect(error.message).toContain("heavy-");
    expect(error.message).not.toContain("tiny-app");
  });

  it("does not move blame to a small application when registry order changes", async () => {
    const ordered = [heavyDesktop.at(-1)!, ...heavyDesktop.slice(0, -1)];
    const error = await refusal(new AtspiBackend(desktop(ordered), "all"));
    expect(error.message).toContain("heavy-");
    expect(error.message).not.toContain("tiny-app");
  });

  it("refuses at the offending application before reading a later blameless application", async () => {
    const channel = desktop(heavyDesktop);
    await refusal(new AtspiBackend(channel, "all"));
    expect(
      channel.asked.some((exchange) => exchange.destination === ":1.6" && exchange.member !== "Get"),
    ).toBe(false);
  });

  it("caps Collection matches with the same application allowance as the walk", async () => {
    const channel = desktop([{ name: "collector", nodes: 1, collection: true, matches: 8000 }]);
    const error = await refusal(new AtspiBackend(channel, "all"));
    expect(error.message).toContain("collector");
  });

  it("does not reset an application's allowance after retiring an untrusted Collection answer", async () => {
    const channel = desktop([{ name: "collector", nodes: 1500, collection: true, matches: 3000, disagreeAt: 3000 }]);
    const error = await refusal(new AtspiBackend(channel, "all"));
    expect(error.message).toContain("collector");
  });

  it("guarantees the measured application size on a crowded desktop", async () => {
    const applications = Array.from({ length: 25 }, (_, index) => ({ name: `app-${index}`, nodes: 1000 }));
    const result = await new AtspiBackend(desktop(applications), "all").queryElements({ role: "button" });
    expect(result.elements).toHaveLength(25 * 999);
  });

  it("keeps the per-application ceiling when only one application is visible", async () => {
    const error = await refusal(new AtspiBackend(desktop([{ name: "large", nodes: 4001 }]), "all"));
    expect(error.message).toContain("large");
  });

  it("leaves the focused-element walk under its existing per-application ceiling", async () => {
    const backend = new AtspiBackend(desktop([{ name: "large", nodes: 4001 }]), "all");
    await expect(backend.focusedElement()).rejects.toThrow(IncompleteObservationError);
  });
});

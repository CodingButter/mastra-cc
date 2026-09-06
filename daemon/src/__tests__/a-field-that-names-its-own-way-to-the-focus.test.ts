import { describe, expect, it } from "vitest";
import type { Channel, Exchange } from "../backends/atspi/channel.js";
import { AtspiBackend } from "../backends/atspi/index.js";

// A CONTROL MAY PUBLISH NO COMPONENT AND STILL BE FOCUSABLE.
//
// Measured 2026-09-05 on this desk: the KDE file dialog behind
// `Add Wallpaper Image…` publishes its file-name entry with NO Component
// interface and an Action named `SetFocus`. Focus went through Component alone,
// so every verb that must focus first - typing, clearing - refused the one
// field that dialog exists to be given, and a run that had already downloaded
// the right picture ended up typing the path into the filter box beside it.
//
// So when Component is absent the element's OWN published focus action is used.
// The word is exact and the element named it; nothing is guessed at. An element
// that names neither route is still refused, in the same words as before.

const ENABLED_BIT = 8;
const VISIBLE_BIT = 30;
const SHOWING_BIT = 25;

const COMPONENT_IFACE = "org.a11y.atspi.Component";
const ACTION_IFACE = "org.a11y.atspi.Action";
const TEXT_IFACE = "org.a11y.atspi.Text";

const BUS = ":1.dialog";
const APP = "/app";
const FIELD = "/field";

interface Staged {
  interfaces: string[];
  actions: string[];
}

function stage(overrides: Partial<Staged> = {}): { channel: Channel; performed: string[] } {
  const staged: Staged = {
    interfaces: [TEXT_IFACE, ACTION_IFACE],
    actions: ["SetFocus"],
    ...overrides,
  };
  const performed: string[] = [];

  const channel: Channel = {
    async call(exchange: Exchange): Promise<unknown[]> {
      if (exchange.destination === "org.a11y.atspi.Registry" && exchange.member === "GetChildren") {
        return [[[BUS, APP]]];
      }
      const isApp = exchange.path === APP;
      switch (exchange.member) {
        case "GetChildren":
          return [isApp ? [[BUS, FIELD]] : []];
        case "GetRoleName":
          return [isApp ? "application" : "entry"];
        case "GetState":
          return [[(1 << ENABLED_BIT) | (1 << VISIBLE_BIT) | (1 << SHOWING_BIT), 0]];
        case "GetInterfaces":
          return [isApp ? [] : staged.interfaces];
        case "GetActions":
          return [isApp ? [] : staged.actions.map((name) => [name, "", ""])];
        case "GetNActions":
          return [isApp ? 0 : staged.actions.length];
        case "GetName": {
          const [index] = exchange.body as [number];
          return [staged.actions[index] ?? ""];
        }
        case "DoAction": {
          const [index] = exchange.body as [number];
          performed.push(staged.actions[index] ?? "");
          return [true];
        }
        case "GetText":
          return [""];
        case "GrabFocus":
          performed.push("GrabFocus");
          return [true];
        case "Get": {
          const [, property] = exchange.body as [string, string];
          if (property === "Name") return [isApp ? "dialog" : ""];
          if (property === "CharacterCount") return [0];
          throw new Error(`unexpected property ${property}`);
        }
        default:
          throw new Error(`unexpected member ${exchange.member}`);
      }
    },
    watch: () => {
      throw new Error("this channel does not watch");
    },
    close: async () => undefined,
  };

  return { channel, performed };
}

async function field(channel: Channel): Promise<{ backend: AtspiBackend; id: string }> {
  const backend = new AtspiBackend(channel, "all");
  const { elements } = await backend.queryElements({});
  const found = elements.find((element) => element.role === "textbox");
  expect(found, "the staged dialog published no field").toBeDefined();
  return { backend, id: found!.id };
}

describe("an element with no Component is given the focus by the action it publishes", () => {
  it("focuses a field that publishes SetFocus and no Component at all", async () => {
    const { channel, performed } = stage();
    const { backend, id } = await field(channel);

    // An empty field clears by focusing it and pressing nothing, which is the
    // shortest route in this backend that must take the focus first.
    const result = await backend.clearElementText({ id });
    await backend.close();

    expect(result.element, "a focus the element published must not be refused").toBeDefined();
    expect(performed).toContain("SetFocus");
  });

  it("still prefers Component where the element publishes one", async () => {
    const { channel, performed } = stage({ interfaces: [TEXT_IFACE, ACTION_IFACE, COMPONENT_IFACE] });
    const { backend, id } = await field(channel);

    await backend.clearElementText({ id });
    await backend.close();

    expect(performed).toContain("GrabFocus");
    expect(performed, "the action route is the fallback, not the first choice").not.toContain("SetFocus");
  });

  it("refuses a field that publishes neither route, in the platform's own words", async () => {
    const { channel } = stage({ actions: ["Press"] });
    const { backend, id } = await field(channel);

    const failure = await backend
      .clearElementText({ id })
      .catch((error: unknown) => error);
    await backend.close();

    expect((failure as Error).message).toContain("being given the focus");
  });
});

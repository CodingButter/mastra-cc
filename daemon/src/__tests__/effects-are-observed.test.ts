import { describe, expect, it } from "vitest";
import { WriteNotObservedError } from "../backend.js";
import type { Channel, Exchange } from "../backends/atspi/channel.js";
import { AtspiBackend } from "../backends/atspi/index.js";

// AN EFFECT THAT READS BACK WITHOUT COMPARING HAS VERIFIED NOTHING.
//
// The defect these tests exist against is not a crash and not a wrong answer in
// the ordinary sense. It is an element: fresh, well-formed, re-read from the
// tree after the write, and therefore indistinguishable from the element a
// successful write produces. The route helper read the world back - which is
// the whole doctrine (ADR-0047) - and then never compared what it read against
// what was asked. A write the platform clamped, ignored, or performed on
// something else came back as a clean element with no refusal anywhere on it.
//
// So every case below stages a platform that behaves exactly as this one was
// measured to behave: it ANSWERS TRUE and changes nothing, or changes something
// other than what was asked. The tree stays readable throughout - that is the
// point. A route that only notices unreadable elements passes all of these
// while verifying nothing.
//
// The seam is the Channel, the same one the replay channel occupies, staged in
// the shape focus-instrument.test.ts established: a small measured-shaped tree
// answering only the members the reader uses, so a reader reaching for an
// instrument this test never staged fails loudly instead of reading a silence.

const ENABLED_BIT = 8;
const VISIBLE_BIT = 30;
const SHOWING_BIT = 25;

const VALUE_IFACE = "org.a11y.atspi.Value";
const TEXT_IFACE = "org.a11y.atspi.Text";
const COMPONENT_IFACE = "org.a11y.atspi.Component";
const ACTION_IFACE = "org.a11y.atspi.Action";

const BUS = ":1.subject";
const APP = "/app";
const SUBJECT = "/subject";

interface Staged {
  /** What the element holds, which the write may or may not change. */
  value: number;
  caret: number;
  text: string;
  /** Showing on screen. Visible-but-not-showing is what reads as offscreen. */
  showing: boolean;
  /** What the platform does with a write: land it, or answer true and not. */
  obeys: boolean;
  /** What the platform answers to DoAction. */
  performs: boolean;
  interfaces: string[];
}

function stage(overrides: Partial<Staged> = {}): { channel: Channel; staged: Staged } {
  const staged: Staged = {
    value: 0.25,
    caret: 0,
    text: "before",
    showing: true,
    obeys: true,
    performs: true,
    interfaces: [VALUE_IFACE, TEXT_IFACE, COMPONENT_IFACE, ACTION_IFACE, "org.a11y.atspi.EditableText"],
    ...overrides,
  };

  const bits = () => {
    let mask = (1 << ENABLED_BIT) | (1 << VISIBLE_BIT);
    if (staged.showing) mask |= 1 << SHOWING_BIT;
    return mask;
  };

  const channel: Channel = {
    async call(exchange: Exchange): Promise<unknown[]> {
      if (exchange.destination === "org.a11y.atspi.Registry" && exchange.member === "GetChildren") {
        return [[[BUS, APP]]];
      }
      const isApp = exchange.path === APP;
      switch (exchange.member) {
        case "GetChildren":
          return [isApp ? [[BUS, SUBJECT]] : []];
        case "GetRoleName":
          return [isApp ? "application" : "entry"];
        case "GetState":
          return [[bits(), 0]];
        case "GetInterfaces":
          return [isApp ? [] : staged.interfaces];
        case "GetActions":
          return [isApp ? [] : [["click", "", ""]]];
        case "GetName":
          return ["click"];
        case "GetNActions":
          return [isApp ? 0 : 1];
        case "DoAction":
          return [staged.performs];
        case "GetText":
          return [staged.text];
        case "SetCaretOffset": {
          const [target] = exchange.body as [number];
          if (staged.obeys) staged.caret = target;
          return [true];
        }
        case "ScrollTo":
          // The measured shape: the platform answers true for a scroll a
          // non-scrolling container never made.
          if (staged.obeys) staged.showing = true;
          return [true];
        case "Get": {
          const [, property] = exchange.body as [string, string];
          if (property === "Name") return [isApp ? "subject" : "field"];
          if (property === "MinimumValue") return [0];
          if (property === "MaximumValue") return [1];
          if (property === "MinimumIncrement") return [0];
          if (property === "CurrentValue") return [staged.value];
          if (property === "CaretOffset") return [staged.caret];
          if (property === "CharacterCount") return [staged.text.length];
          throw new Error(`unexpected property ${property}`);
        }
        case "Set": {
          const [, property, variant] = exchange.body as [string, string, [string, number]];
          if (property !== "CurrentValue") throw new Error(`unexpected write to ${property}`);
          if (staged.obeys) staged.value = variant[1];
          return [];
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

  return { channel, staged };
}

async function subject(channel: Channel): Promise<{ backend: AtspiBackend; id: string }> {
  const backend = new AtspiBackend(channel, "all");
  const { elements } = await backend.queryElements({});
  const found = elements.find((element) => element.role === "textbox");
  expect(found, "the staged tree published no subject element").toBeDefined();
  return { backend, id: found!.id };
}

describe("an operation whose write the platform did not perform is refused, not answered with an element", () => {
  it("refuses a magnitude the platform reported and did not move", async () => {
    const { channel } = stage({ obeys: false });
    const { backend, id } = await subject(channel);

    const failure = await backend.setElementValue({ id, value: 0.75 }).catch((error: unknown) => error);
    await backend.close();

    // The element is readable throughout: a route that only catches unreadable
    // elements answers this call with a clean element holding 0.25.
    expect(failure).toBeInstanceOf(WriteNotObservedError);
    expect((failure as Error).message).toContain("0.25");
  });

  it("refuses a caret the platform reported and did not place", async () => {
    const { channel } = stage({ obeys: false });
    const { backend, id } = await subject(channel);

    const failure = await backend.setElementCaret({ id, offset: 3 }).catch((error: unknown) => error);
    await backend.close();

    expect(failure).toBeInstanceOf(WriteNotObservedError);
  });

  it("refuses a reveal that left the element off screen", async () => {
    const { channel } = stage({ obeys: false, showing: false });
    const { backend, id } = await subject(channel);

    const failure = await backend.revealElement({ id }).catch((error: unknown) => error);
    await backend.close();

    expect(failure).toBeInstanceOf(WriteNotObservedError);
  });

  it("refuses an action the application declined, rather than re-reading and calling it done", async () => {
    // An action is a bare verb: the element publishes no state saying what the
    // verb was supposed to change, so the platform's own `false` is the only
    // reading there is. Discarding it left activate with none.
    const { channel } = stage({ performs: false });
    const { backend, id } = await subject(channel);

    const failure = await backend.activateElement({ id, action: "click" }).catch((error: unknown) => error);
    await backend.close();

    expect(failure).toBeInstanceOf(WriteNotObservedError);
    expect((failure as Error).message).toContain("declined");
  });
});

describe("an operation the platform did perform answers with the element, and says nothing about it", () => {
  // The non-vacuity guard. A route that refused everything would pass every
  // test above and fail every one below.
  it("answers a landed magnitude with the element as it reads afterwards", async () => {
    const { channel, staged } = stage();
    const { backend, id } = await subject(channel);

    const { element } = await backend.setElementValue({ id, value: 0.75 });
    await backend.close();

    expect(element).toBeDefined();
    expect(staged.value, "the write never reached the platform").toBe(0.75);
  });

  it("answers a landed caret with the element as it reads afterwards", async () => {
    const { channel, staged } = stage();
    const { backend, id } = await subject(channel);

    const { element } = await backend.setElementCaret({ id, offset: 3 });
    await backend.close();

    expect(element).toBeDefined();
    expect(staged.caret).toBe(3);
  });

  it("answers a landed reveal with the element as it reads afterwards", async () => {
    const { channel, staged } = stage({ showing: false });
    const { backend, id } = await subject(channel);

    const { element } = await backend.revealElement({ id });
    await backend.close();

    expect(element).toBeDefined();
    expect(staged.showing).toBe(true);
  });

  it("answers a performed action with the element as it reads afterwards", async () => {
    const { channel } = stage();
    const { backend, id } = await subject(channel);

    const { element } = await backend.activateElement({ id, action: "click" });
    await backend.close();

    expect(element).toBeDefined();
  });
});

// THE TWO EXEMPTIONS, ASSERTED RATHER THAN ASSUMED.
//
// Both are deliberate, and both would be quietly undone by a later change that
// "finished the job" by making every verb compare. These tests are what makes
// that change fail loudly instead.
describe("the two operations that deliberately do not compare", () => {
  it("submitElement answers a commit whose target stopped existing by omitting the element, never by refusing", async () => {
    // A commit can close its own window in about a millisecond (measured, proof
    // leg s). Refusing here would tell a caller nothing was committed for
    // something that already happened and cannot be taken back - and a caller
    // reading that refusal commits again. The element is omitted instead: the
    // wire does not require it. Pinned in full in attestation.test.ts; asserted
    // here so the exemption is visible beside the rule it is an exception to.
    const { channel } = stage();
    let committed = false;
    const dying: Channel = {
      async call(exchange: Exchange) {
        if (committed) throw new Error("Message recipient disconnected from message bus without replying");
        if (exchange.member === "DoAction") {
          committed = true;
          return [true];
        }
        return channel.call(exchange);
      },
      watch: () => {
        throw new Error("this channel does not watch");
      },
      close: async () => undefined,
    };
    const { backend, id } = await subject(dying);

    const result = await backend.submitElement({ id, attestation: "commits the field" });
    await backend.close();

    expect(committed).toBe(true);
    expect(result.element, "a commit that landed must not be answered with a refusal").toBeUndefined();
  });

  it("grabFocus reports nothing about whether focus moved - the caller reads the tree back", async () => {
    // ADR-0044: whether the keyboard moved is decided by comparing two readings
    // of the whole desktop, which is a question no single element can answer.
    // restoreFocus therefore returns the focused element as it now reads and
    // makes no claim of its own. Segment 4 owns what that reading is worth.
    const { channel } = stage();
    const { backend, id } = await subject(channel);

    // The staged tree publishes no focused element, so the honest answer is
    // that nothing holds the keyboard - not a claim that the grab worked.
    const focused = await backend.restoreFocus(id).catch(() => undefined);
    await backend.close();

    expect(focused).toBeUndefined();
  });
});

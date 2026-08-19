import { describe, expect, it } from "vitest";
import { AtspiBackend } from "../atspi/index.js";
import type { Channel, Exchange } from "../atspi/channel.js";

// WHICH READING IS THE KEYBOARD (ADR-0044).
//
// These tests exist because the first implementation of focus preservation
// passed a full green suite and was still wrong on a real desktop. It read the
// bus's "focused" state and nothing else; the live proof leg then measured a
// launch taking the keyboard away from a dialog while that dialog went on
// publishing "focused" the entire time. The daemon reported a clean launch and
// the keyboard was somewhere the caller never asked for - precisely the harm
// ADR-0044 exists to prevent.
//
// The tree below is not invented. It is the shape MEASURED on this machine,
// hands off, twice, reduced to the smallest tree that carries the same trap:
//
//   gnome-shell     window, focused, NOT under an activated ancestor
//   gnome-terminal  terminal, focused, NOT under an activated ancestor
//   yad             frame ACTIVATED -> text, focused        <- the keyboard
//   qt6ct           filler ACTIVATED (no focused child yet)
//
// Four nodes publishing "focused" at once, in three applications, exactly one
// of which can receive a keystroke. A reader that trusts "focused" alone has a
// three-in-four chance of naming the wrong element, and - the part that
// actually bit - it names the SAME wrong element before and after a launch, so
// the comparison that is supposed to detect a stolen keyboard always agrees
// with itself.

const ACTIVE_BIT = 1;
const FOCUSED_BIT = 12;
const ENABLED_BIT = 8;
const VISIBLE_BIT = 30;
const SHOWING_BIT = 25;

interface Node {
  readonly path: string;
  readonly role: string;
  readonly name: string;
  readonly bits: number[];
  readonly children: string[];
}

// One application per bus name, mirroring how the real bus presents them.
interface App {
  readonly busName: string;
  readonly name: string;
  readonly nodes: Node[];
}

function states(bits: number[]): number {
  return bits.reduce((acc, bit) => acc | (1 << bit), 0);
}

const BASE = [ENABLED_BIT, VISIBLE_BIT, SHOWING_BIT];

// The measured desktop, reduced. `keyboardIn` names the application whose
// window is activated - moving it is how a launch is simulated.
function desktop(keyboardIn: "yad" | "qt6ct"): App[] {
  return [
    {
      busName: ":1.shell",
      name: "gnome-shell",
      nodes: [
        { path: "/app", role: "application", name: "gnome-shell", bits: BASE, children: ["/win"] },
        // Focused, permanently, and never the keyboard: this is the node that
        // made the original reader answer the same thing forever.
        { path: "/win", role: "window", name: "", bits: [...BASE, FOCUSED_BIT], children: [] },
      ],
    },
    {
      busName: ":1.terminal",
      name: "gnome-terminal-server",
      nodes: [
        { path: "/app", role: "application", name: "gnome-terminal-server", bits: BASE, children: ["/term"] },
        { path: "/term", role: "terminal", name: "Terminal", bits: [...BASE, FOCUSED_BIT], children: [] },
      ],
    },
    {
      busName: ":1.yad",
      name: "yad",
      nodes: [
        { path: "/app", role: "application", name: "yad", bits: BASE, children: ["/frame"] },
        {
          path: "/frame",
          role: "frame",
          name: "m2-6-3 focus subject",
          bits: keyboardIn === "yad" ? [...BASE, ACTIVE_BIT] : BASE,
          children: ["/text"],
        },
        // Publishes "focused" in BOTH worlds - the application never clears it
        // when it loses the keyboard. That is the whole trap.
        { path: "/text", role: "text", name: "", bits: [...BASE, FOCUSED_BIT], children: [] },
      ],
    },
    {
      busName: ":1.qt6ct",
      name: "qt6ct",
      nodes: [
        { path: "/app", role: "application", name: "qt6ct", bits: BASE, children: ["/filler"] },
        // MEASURED: qt6ct carries the activation on a "filler", not on a frame.
        // A reader that only looks for window-ish roles finds nothing here.
        {
          path: "/filler",
          role: "filler",
          name: "",
          bits: keyboardIn === "qt6ct" ? [...BASE, ACTIVE_BIT] : BASE,
          children: ["/entry"],
        },
        {
          path: "/entry",
          role: "entry",
          name: "Style",
          bits: keyboardIn === "qt6ct" ? [...BASE, FOCUSED_BIT] : BASE,
          children: [],
        },
      ],
    },
  ];
}

// A channel over that tree. Only the members the reader actually uses are
// answered; anything else throws, so a reader reaching for a second instrument
// fails loudly rather than silently reading something this test never staged.
function channelOver(apps: App[]): Channel {
  const byRef = new Map<string, Node>();
  const appOf = new Map<string, App>();
  for (const app of apps) {
    for (const node of app.nodes) {
      byRef.set(`${app.busName}${node.path}`, node);
      appOf.set(`${app.busName}${node.path}`, app);
    }
  }
  return {
    async call(x: Exchange): Promise<unknown[]> {
      if (x.destination === "org.a11y.atspi.Registry" && x.member === "GetChildren") {
        return [apps.map((app) => [app.busName, "/app"])];
      }
      const key = `${x.destination}${x.path}`;
      const node = byRef.get(key);
      if (node === undefined) throw new Error(`no such node ${key}`);
      switch (x.member) {
        case "GetChildren":
          return [node.children.map((child) => [x.destination, child])];
        case "GetRoleName":
          return [node.role];
        case "GetState":
          return [[states(node.bits), 0]];
        case "Get": {
          const [, property] = x.body as [string, string];
          if (property === "Name") return [node.name];
          throw new Error(`unexpected property ${property}`);
        }
        case "GetInterfaces":
          return [[]];
        case "GetActions":
        case "GetNActions":
          return [[]];
        default:
          throw new Error(`unexpected member ${x.member}`);
      }
    },
    watch: () => {
      throw new Error("this channel does not watch");
    },
    close: async () => undefined,
  };
}

describe("what holds the keyboard, on a desktop where four nodes claim focus", () => {
  it("names the focused element inside the activated window, not the first one publishing focus", async () => {
    const backend = new AtspiBackend(channelOver(desktop("yad")), "all");
    const focused = await backend.focusedElement();
    await backend.close();
    // gnome-shell's window is walked first and publishes "focused". The answer
    // must be the dialog's text field, which is the only one under activation.
    expect(focused?.role).toBe("text");
    expect(focused?.states).toContain("focused");
  });

  it("moves when the keyboard moves - the comparison a launch depends on", async () => {
    // THE REGRESSION. The old reader answered gnome-shell's window in both
    // worlds; the server compared the two answers, found them identical, and
    // concluded the launch took nothing. Both readings must differ here, or
    // focus preservation is measuring a constant.
    const before = new AtspiBackend(channelOver(desktop("yad")), "all");
    const held = await before.focusedElement();
    await before.close();

    const after = new AtspiBackend(channelOver(desktop("qt6ct")), "all");
    const now = await after.focusedElement();
    await after.close();

    expect(held?.role).toBe("text");
    // the neutral role the wire publishes, not the native word the tree used
    expect(now?.role).toBe("textbox");
    expect(now?.name).toBe("Style");
    expect(now?.id).not.toBe(held?.id);
  });

  it("finds an activation published on a node that is not window-shaped", async () => {
    // qt6ct carries it on a "filler". Keying the ancestor test to a set of
    // window-ish roles is a role table deciding what an element is (ADR-0045
    // clause 2), and it answers "nothing holds focus" on this desktop.
    const backend = new AtspiBackend(channelOver(desktop("qt6ct")), "all");
    const focused = await backend.focusedElement();
    await backend.close();
    expect(focused?.name).toBe("Style");
  });

  it("answers nothing rather than guessing when no window is activated", async () => {
    // Three applications still publish "focused" here. A desktop with no
    // activated window is an ordinary desktop (a locked screen, a compositor
    // menu holding the keyboard) and "nothing" is the honest answer; guessing
    // one of the three would be the original bug with extra steps.
    const noActivation = desktop("yad").map((app) =>
      app.name !== "yad"
        ? app
        : { ...app, nodes: app.nodes.map((n) => (n.path === "/frame" ? { ...n, bits: BASE } : n)) },
    );
    const backend = new AtspiBackend(channelOver(noActivation), "all");
    const focused = await backend.focusedElement();
    await backend.close();
    expect(focused).toBeUndefined();
  });

  it("does not report a focused element inside an application this session cannot see", async () => {
    // The visibility gate applies to this read exactly as it applies to every
    // other one: the answer is not a second door into an ungranted application
    // (ADR-0036). yad holds the keyboard; a session that cannot see yad gets
    // nothing, not the next-best focused node from somewhere else.
    const backend = new AtspiBackend(channelOver(desktop("yad")), new Set(["qt6ct"]));
    const focused = await backend.focusedElement();
    await backend.close();
    expect(focused).toBeUndefined();
  });
});

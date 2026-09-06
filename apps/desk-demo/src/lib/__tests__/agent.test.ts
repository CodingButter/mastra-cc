import { describe, expect, it, vi } from "vitest";
import { MastraCC } from "@mastra-cc/desktop/mastra";
import { isTransportConnectionError } from "@mastra-cc/desktop/mastra";
import { HANDOVER_BEFORE_LOOKING, HANDOVER_INSTRUCTIONS, wiredDeskTools } from "../agent";
import { DeskCache } from "../desk-cache";
import type { DemoEvent } from "../events";

function fakeDesk(execute: () => Promise<unknown>): MastraCC {
  return {
    getTools: () => ({
      queryElements: {
        execute,
      },
    }),
  } as unknown as MastraCC;
}

describe("handover instructions", () => {
  it("requires an immediate tool call at user-only authority boundaries", () => {
    expect(HANDOVER_INSTRUCTIONS).toContain("REQUIRED NEXT ACTION");
    expect(HANDOVER_INSTRUCTIONS).toContain("Do not merely say that");
    expect(HANDOVER_INSTRUCTIONS).toContain("Do not finish the turn");
    expect(HANDOVER_INSTRUCTIONS).toContain("Do not hand over for ordinary navigation");
    expect(HANDOVER_INSTRUCTIONS).toContain("read the desk again");
  });

  it("owns configured browser, taskbar, and KDE facts rather than generic discovery", () => {
    const flat = HANDOVER_INSTRUCTIONS.replace(/\s+/g, " ");
    for (const fact of ["without a file chooser", "chrome://downloads", "pixel dimensions",
      "KDE Plasma", "taskbar buttons", "Press action", "Set as Wallpaper",
      "plasma-org.kde.plasma.desktop-appletsrc", "usersWallpapers",
      "not guarantees about other desktops", "pending or failed download is not a saved file",
      "Verify the active setting and visible desktop outcome"]) {
      expect(flat).toContain(fact);
    }
    expect(HANDOVER_INSTRUCTIONS).not.toContain("discoverElements");
    expect(HANDOVER_INSTRUCTIONS).not.toContain("clickAncestor");
    expect(HANDOVER_INSTRUCTIONS).not.toContain("browser chrome and web content");
  });

  it("names web search, downloads and settings as ordinary desktop work rather than boundaries", () => {
    // The wallpaper dogfood: the agent refused all three by category, with no
    // tool call, on a desk that had every one of them.
    expect(HANDOVER_INSTRUCTIONS).toContain("refuses until you\nhave looked");
    expect(HANDOVER_INSTRUCTIONS).toContain("Searching the web, downloading a file, opening a settings window");
    expect(HANDOVER_INSTRUCTIONS).toContain("ordinary desktop work on this desk, not\nboundaries");
    expect(HANDOVER_INSTRUCTIONS).toContain("identity, money, or private\njudgement");
  });
});

describe("a handover asked for before looking", () => {
  it("is refused with somewhere to go, and does not unlock the desk", () => {
    expect(HANDOVER_BEFORE_LOOKING.handedBack).toBe(false);
    expect(HANDOVER_BEFORE_LOOKING.refused).toContain("not looked at this desk yet");
    expect(HANDOVER_BEFORE_LOOKING.advice).toContain("listApplications");
  });

  // The gate has to be tested through the agent the route builds, not through
  // a callback the test supplies itself: the bug being pinned is an agent that
  // handed the desk over having called nothing, and only deskAgent knows
  // whether requestHumanControl and the wired tools share a memory.
  it("is refused by the real agent's tool until a desk tool has been tried", async () => {
    const { deskAgent } = await import("../agent");
    const { release } = await import("../control");
    const events: DemoEvent[] = [];
    const tools = (await deskAgent((event) => events.push(event)).listTools()) as unknown as Record<
      string,
      { execute: (input: unknown, context?: unknown) => Promise<unknown> }
    >;

    await expect(tools.requestHumanControl.execute({ reason: "sign in" })).resolves.toEqual(
      HANDOVER_BEFORE_LOOKING,
    );

    // This desk is not there, and that is the point: what unlocks the handover
    // is having asked, not having been answered.
    await expect(tools.queryElements.execute({ role: "button" } as never, {} as never)).rejects.toThrow();

    // Not the refusal any more: the desk has been consulted, so the handover
    // reaches the person. The proof is the control event, not a race - the
    // refusal returns without ever emitting one.
    expect(events.filter((event) => event.type === "control")).toEqual([]);
    const handover = tools.requestHumanControl.execute({ reason: "sign in" });
    let requestId = "";
    await vi.waitFor(() => {
      const control = events.find((event) => event.type === "control" && event.mode === "interact") as
        | { requestId: string }
        | undefined;
      expect(control).toBeDefined();
      requestId = control!.requestId;
    });
    // Hand it back, so no later test inherits an open handover.
    release(requestId);
    await handover;
  });
});

describe("wiredDeskTools", () => {
  it.each(["cancel", "handover", "healthy"] as const)("rechecks %s after a delayed connection before real dispatch", async (mode) => {
    const { requestControl, release } = await import("../control");
    const desk = new MastraCC();
    type Client = Awaited<ReturnType<MastraCC["client"]>>;
    let resolveDial!: (client: Client) => void;
    const dial = new Promise<Client>((resolve) => { resolveDial = resolve; });
    const queryElements = vi.fn(async () => ({ elements: [] }));
    vi.spyOn(desk, "client").mockReturnValue(dial);
    const cache = new DeskCache<MastraCC>(() => desk);
    const events: DemoEvent[] = [];
    const stop = vi.fn();
    const abort = new AbortController();
    const wired = wiredDeskTools(cache.get(), cache, event => events.push(event), stop, isTransportConnectionError, () => {}, abort.signal);
    const pending = wired.queryElements.execute!({ role: "button" } as never, {} as never);
    expect(queryElements).not.toHaveBeenCalled();
    expect(events.map(event => event.type)).toEqual(["tool"]);
    const handover = mode === "handover" ? requestControl("sign in", 1000) : undefined;
    if (mode === "cancel") abort.abort(new Error("turn cancelled"));
    try {
      resolveDial({ queryElements } as unknown as Client);
      if (mode === "healthy") {
        await expect(pending).resolves.toEqual({ elements: [] });
        expect(queryElements).toHaveBeenCalledExactlyOnceWith({ role: "button" });
      } else {
        await expect(pending).rejects.toThrow(mode === "cancel" ? "turn cancelled" : "person has control");
        expect(queryElements).not.toHaveBeenCalled();
      }
      expect(stop).toHaveBeenCalledTimes(mode === "handover" ? 1 : 0);
      expect(cache.get()).toBe(desk);
      expect(events.map(event => event.type)).toEqual(["tool", "tool-result"]);
      const calls = events.filter(event => event.type === "tool");
      const results = events.filter(event => event.type === "tool-result");
      expect(results[0]!.callId).toBe(calls[0]!.callId);
    } finally {
      if (handover) {
        release(handover.requestId);
        await handover.done;
      }
    }
  });

  it("does not dispatch a fresh tool after cancellation", async () => {
    const execute = vi.fn(async () => "ok");
    const desk = fakeDesk(execute);
    const cache = new DeskCache<MastraCC>(() => desk);
    const abort = new AbortController();
    const wired = wiredDeskTools(desk, cache, () => {}, () => {}, isTransportConnectionError, () => {}, abort.signal);
    abort.abort(new Error("turn cancelled"));
    await expect(wired.queryElements.execute!({ role: "button" } as never, {} as never)).rejects.toThrow("turn cancelled");
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not dispatch tools while the person controls the desk", async () => {
    const { requestControl, release } = await import("../control");
    const execute = vi.fn(async () => "ok");
    const desk = fakeDesk(execute);
    const cache = new DeskCache<MastraCC>(() => desk);
    const stop = vi.fn();
    const wired = wiredDeskTools(desk, cache, () => {}, stop, isTransportConnectionError, () => {});
    const { requestId, done } = requestControl("sign in", 1000);
    try {
      await expect(wired.queryElements.execute!({ role: "button" } as never, {} as never)).rejects.toThrow("person has control");
      expect(execute).not.toHaveBeenCalled();
      expect(stop).toHaveBeenCalledOnce();
    } finally {
      release(requestId);
      await done;
    }
  });

  it("invalidates a terminally failed desk, aborts once, and does not retry", async () => {
    const terminal = new Error("transport: connection closed");
    const execute = vi.fn(async () => {
      throw terminal;
    });
    const first = fakeDesk(execute);
    const second = fakeDesk(async () => "ok");
    const create = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const cache = new DeskCache<MastraCC>(create);
    const events: DemoEvent[] = [];
    const abort = vi.fn();
    const wired = wiredDeskTools(
      cache.get(),
      cache,
      (event) => events.push(event),
      abort,
      (error) => error === terminal,
      () => {},
    );

    await expect(wired.queryElements.execute!({ role: "button" } as never, {} as never)).rejects.toBe(terminal);

    expect(execute).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledExactlyOnceWith(terminal);
    expect(cache.get()).toBe(second);
    expect(events.map((event) => event.type)).toEqual(["tool", "tool-result"]);
    expect(events[0]?.type === "tool" && events[0].callId).toBeTruthy();
    expect(events[1]?.type === "tool-result" && events[1].callId).toBe(
      events[0]?.type === "tool" ? events[0].callId : undefined,
    );
  });

  it("gives each invocation one unique call id shared by its result", async () => {
    const desk = fakeDesk(async () => "ok");
    const cache = new DeskCache<MastraCC>(() => desk);
    const events: DemoEvent[] = [];
    const wired = wiredDeskTools(cache.get(), cache, event => events.push(event), () => {}, isTransportConnectionError, () => {});

    await wired.queryElements.execute!({ role: "button" } as never, {} as never);
    await wired.queryElements.execute!({ role: "window" } as never, {} as never);

    const calls = events.filter(event => event.type === "tool");
    const results = events.filter(event => event.type === "tool-result");
    expect(calls).toHaveLength(2);
    expect(results).toHaveLength(2);
    expect(calls[0]!.callId).not.toBe(calls[1]!.callId);
    expect(results.map(event => event.callId)).toEqual(calls.map(event => event.callId));
  });

  it("keeps a healthy desk after an ordinary refusal", async () => {
    const refusal = new Error("desktop: refused");
    const desk = fakeDesk(async () => {
      throw refusal;
    });
    const create = vi.fn(() => desk);
    const cache = new DeskCache<MastraCC>(create);
    const abort = vi.fn();
    const wired = wiredDeskTools(cache.get(), cache, () => {}, abort, isTransportConnectionError, () => {});

    await expect(wired.queryElements.execute!({} as never, {} as never)).rejects.toBe(refusal);

    expect(abort).not.toHaveBeenCalled();
    expect(cache.get()).toBe(desk);
    expect(create).toHaveBeenCalledOnce();
  });

  it("reports that the desk was consulted even when the desk refused", async () => {
    // What unlocks a handover is having ASKED. An agent that queried and was
    // refused has heard from the desk and may hand over on what it heard.
    const refusal = new Error("desktop: refused");
    const desk = fakeDesk(async () => {
      throw refusal;
    });
    const cache = new DeskCache<MastraCC>(() => desk);
    const looked = vi.fn();
    const wired = wiredDeskTools(cache.get(), cache, () => {}, () => {}, () => false, looked);

    await expect(wired.queryElements.execute!({} as never, {} as never)).rejects.toBe(refusal);

    expect(looked).toHaveBeenCalledOnce();
  });
});

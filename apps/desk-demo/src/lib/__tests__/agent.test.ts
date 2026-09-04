import { describe, expect, it, vi } from "vitest";
import type { MastraCC } from "@mastra-cc/desktop/mastra";
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
    expect(HANDOVER_INSTRUCTIONS).toContain("Scope semantic queries to the known application");
    expect(HANDOVER_INSTRUCTIONS).toContain("browser chrome and web content may not share one");
    expect(HANDOVER_INSTRUCTIONS).toContain("retry with\nthe application scope");
    expect(HANDOVER_INSTRUCTIONS).toContain("call discoverElements in that scope before guessing");
    expect(HANDOVER_INSTRUCTIONS).toContain("possibly truncated vocabulary\nhints—not element handles");
    expect(HANDOVER_INSTRUCTIONS).toContain("issue a fresh exact\nqueryElements call");
    expect(HANDOVER_INSTRUCTIONS).toContain("A scope narrows observation;\nit never grants access");
    expect(HANDOVER_INSTRUCTIONS).toContain("shell-owned controls such as taskbar");
    expect(HANDOVER_INSTRUCTIONS).toContain("discard old content element IDs");
    expect(HANDOVER_INSTRUCTIONS).toContain("fresh IDs returned by that read");
    expect(HANDOVER_INSTRUCTIONS).toContain("query text and list items with");
    expect(HANDOVER_INSTRUCTIONS).toContain("clickAncestor");
    expect(HANDOVER_INSTRUCTIONS).toContain("reread the\ndestination scope");
    expect(HANDOVER_INSTRUCTIONS).toContain("verify that the page changed");
    expect(HANDOVER_INSTRUCTIONS).toContain("read the desk again");
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

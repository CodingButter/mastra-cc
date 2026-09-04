import { describe, expect, it, vi } from "vitest";
import type { MastraCC } from "@mastra-cc/desktop/mastra";
import { HANDOVER_INSTRUCTIONS, wiredDeskTools } from "../agent";
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
    const wired = wiredDeskTools(cache.get(), cache, event => events.push(event), () => {});

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
    const wired = wiredDeskTools(cache.get(), cache, () => {}, abort);

    await expect(wired.queryElements.execute!({} as never, {} as never)).rejects.toBe(refusal);

    expect(abort).not.toHaveBeenCalled();
    expect(cache.get()).toBe(desk);
    expect(create).toHaveBeenCalledOnce();
  });
});

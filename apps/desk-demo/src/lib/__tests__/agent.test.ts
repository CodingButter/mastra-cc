import { describe, expect, it, vi } from "vitest";
import type { MastraCC } from "@mastra-cc/desktop/mastra";
import { wiredDeskTools } from "../agent";
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeEvent } from "@mastra-cc/protocol-types";
import { DesktopSignals } from "../signals.js";

const event = (patch: Partial<ChangeEvent> = {}): ChangeEvent => ({ id: "el-0123456789ab", subscriptionId: "sub-1", role: "textbox", kind: "changed", attribution: "external", priority: "low", at: 1, ...patch });
const providers: DesktopSignals[] = [];
async function setup(gap = 1000) {
  let emit!: (event: ChangeEvent) => void;
  const provider = new DesktopSignals({ client: async () => ({ onChangeEvent: (callback: typeof emit) => { emit = callback; return () => {}; } }) as never, target: { threadId: "t", resourceId: "r" }, options: { dedupeWindowMs: gap } });
  const send = vi.fn().mockResolvedValue(undefined);
  provider.connect({ sendNotificationSignal: send } as never);
  providers.push(provider);
  await provider.start();
  return { provider, emit: (event: ChangeEvent) => emit(event), send };
}
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
afterEach(() => { for (const provider of providers.splice(0)) provider.stop(); vi.useRealTimers(); });

describe("bounded signal retention", () => {
  it("uses receipt time, not future or backward event timestamps", async () => {
    const s = await setup(); s.emit(event({ at: 9000000 })); s.emit(event({ at: 1 }));
    expect(s.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.send).toHaveBeenCalledTimes(2);
    expect(s.send.mock.calls[1][0].attributes.at).toBe(1);
  });
  it("does not let forged advancing timestamps bypass the same-key gap", async () => {
    const s = await setup(); for (let i = 0; i < 100; i++) s.emit(event({ at: i * 1000 }));
    expect(s.send).toHaveBeenCalledTimes(1);
  });
  it("delivers the final suppressed change without another desktop event", async () => {
    const s = await setup(); s.emit(event()); await vi.advanceTimersByTimeAsync(10);
    s.emit(event({ at: 2 })); s.emit(event({ at: 3 }));
    await vi.advanceTimersByTimeAsync(990);
    expect(s.send).toHaveBeenCalledTimes(2);
    expect(s.send.mock.calls[1][0].attributes.at).toBe(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.send).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds aggregate wakes under unique-key churn and eventually invalidates overflow", async () => {
    const s = await setup();
    for (let i = 0; i < 10000; i++) s.emit(event({ subscriptionId: `sub-${i}` }));
    expect(s.send).toHaveBeenCalledTimes(32); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.send).toHaveBeenCalledTimes(64);
    expect(s.send.mock.calls.some(([notification]) => notification.summary.includes("coalesced"))).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    ["low", "medium", "medium"], ["medium", "low", "medium"],
    ["medium", "high", "high"], ["high", "medium", "high"],
    ["high", "low", "high"], ["low", "high", "high"],
  ] as const)("gives overflow its own identity and preserves priority %s → %s as %s", async (first, second, highest) => {
    const s = await setup();
    for (let i = 0; i < 1000; i++) s.emit(event({ subscriptionId: `sub-${i}`, priority: i === 32 ? first : i === 33 ? second : "low" }));
    await vi.advanceTimersByTimeAsync(1000);
    const broad = s.send.mock.calls.map(([notification]) => notification).find(x => x.kind === "desktop.coalesced");
    expect(broad).toMatchObject({ priority: highest, dedupeKey: "desktop-overflow", coalesceKey: "desktop-overflow", attributes: { coalesced: true } });
    expect(broad.sourceId).toBeUndefined(); expect(broad.attributes.subscriptionId).toBeUndefined(); expect(broad.attributes.attribution).toBeUndefined();
  });
  it("retires the pending trailing wake on stop and restarts with an empty budget", async () => {
    const s = await setup(); s.emit(event()); s.emit(event({ at: 2 })); s.provider.stop();
    await vi.advanceTimersByTimeAsync(2000); expect(s.send).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    await s.provider.start(); s.emit(event()); expect(s.send).toHaveBeenCalledTimes(2);
  });
  it("keeps explicit throttle disable timer-free", async () => {
    const s = await setup(0); for (let i = 0; i < 100; i++) s.emit(event());
    expect(s.send).toHaveBeenCalledTimes(100); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not schedule excluded attributions", async () => {
    const s = await setup(); s.emit(event({ attribution: "self" })); s.emit(event({ attribution: "unattributed" }));
    expect(s.send).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});

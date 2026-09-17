import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangeEvent } from "@mastra-cc/protocol-types";
import type { TransportClient } from "@mastra-cc/transport";
import { DesktopSignals } from "../signals.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  const listeners = new Set<(event: ChangeEvent) => void>();
  const callbacks: Array<(event: ChangeEvent) => void> = [];
  const detach = vi.fn();
  const close = vi.fn();
  const client = {
    close,
    onChangeEvent(callback: (event: ChangeEvent) => void) {
      callbacks.push(callback);
      listeners.add(callback);
      return () => { detach(); listeners.delete(callback); };
    },
  } as unknown as TransportClient;
  const acquire = vi.fn<() => Promise<TransportClient>>();
  const sendNotificationSignal = vi.fn().mockResolvedValue(undefined);
  const provider = new DesktopSignals({ client: acquire, target: { threadId: "t", resourceId: "r" }, options: { dedupeWindowMs: 0 } });
  provider.connect({ sendNotificationSignal } as never);
  return { provider, client, acquire, listeners, callbacks, detach, close, sendNotificationSignal };
}
const event: ChangeEvent = { id: "el-0123456789ab", subscriptionId: "sub-1", role: "textbox", kind: "changed", attribution: "external", priority: "low", at: 1 };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
afterEach(() => vi.restoreAllMocks());

describe("signal listener lifetime", () => {
  it("shares pending acquisition between concurrent starts", async () => {
    const s = setup(), ready = deferred<TransportClient>();
    s.acquire.mockReturnValue(ready.promise);
    const first = s.provider.start(), second = s.provider.start();
    expect(s.acquire).toHaveBeenCalledTimes(1);
    ready.resolve(s.client); await Promise.all([first, second]);
    expect(s.listeners.size).toBe(1);
    s.provider.stop(); s.provider.stop();
    expect(s.detach).toHaveBeenCalledTimes(1); expect(s.close).not.toHaveBeenCalled();
  });
  it("stop cancels a pending attachment", async () => {
    const s = setup(), ready = deferred<TransportClient>(); s.acquire.mockReturnValue(ready.promise);
    const start = s.provider.start(); s.provider.stop(); ready.resolve(s.client); await start;
    expect(s.listeners.size).toBe(0); expect(s.callbacks).toHaveLength(0); expect(s.close).not.toHaveBeenCalled();
  });
  it("old completion cannot attach over a restarted listener", async () => {
    const s = setup(), old = deferred<TransportClient>(), current = deferred<TransportClient>();
    s.acquire.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const first = s.provider.start(); s.provider.stop(); const second = s.provider.start();
    current.resolve(s.client); await second; old.resolve(s.client); await first;
    expect(s.listeners.size).toBe(1); expect(s.callbacks).toHaveLength(1);
    s.provider.stop(); expect(s.listeners.size).toBe(0); expect(s.detach).toHaveBeenCalledTimes(1);
  });
  it("old rejection cannot clear a newer pending startup", async () => {
    const s = setup(), old = deferred<TransportClient>(), current = deferred<TransportClient>();
    s.acquire.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const first = s.provider.start(); const rejected = expect(first).rejects.toThrow("old acquisition");
    s.provider.stop(); const second = s.provider.start(); old.reject(new Error("old acquisition")); await rejected;
    const third = s.provider.start(); expect(s.acquire).toHaveBeenCalledTimes(2);
    current.resolve(s.client); await Promise.all([second, third]); expect(s.listeners.size).toBe(1); s.provider.stop();
  });
  it("allows retry after rejected acquisition", async () => {
    const s = setup(); s.acquire.mockRejectedValueOnce(new Error("acquisition failed")).mockResolvedValue(s.client);
    await expect(s.provider.start()).rejects.toThrow("acquisition failed"); await s.provider.start();
    expect(s.listeners.size).toBe(1); s.provider.stop();
  });
  it("retired callbacks cannot notify after stop or restart", async () => {
    const s = setup(); s.acquire.mockResolvedValue(s.client); await s.provider.start();
    const retired = s.callbacks[0]; s.provider.stop(); retired(event); await settle();
    expect(s.sendNotificationSignal).not.toHaveBeenCalled();
    await s.provider.start(); retired(event); s.callbacks[1](event); await settle();
    expect(s.sendNotificationSignal).toHaveBeenCalledTimes(1); s.provider.stop();
  });
  it("does not retract pending delivery or start another after stop", async () => {
    const s = setup(), delivered = deferred<void>(); s.acquire.mockResolvedValue(s.client);
    s.sendNotificationSignal.mockReturnValue(delivered.promise); await s.provider.start();
    s.callbacks[0](event); expect(s.sendNotificationSignal).toHaveBeenCalledTimes(1);
    s.provider.stop(); s.callbacks[0](event); delivered.resolve(); await settle();
    expect(s.sendNotificationSignal).toHaveBeenCalledTimes(1); expect(s.close).not.toHaveBeenCalled();
  });
  it("contains notification rejections without retry or unbounded error logging", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = setup(); s.acquire.mockResolvedValue(s.client);
    s.sendNotificationSignal.mockRejectedValue(new Error("private notification contents")); await s.provider.start();
    s.callbacks[0](event); s.callbacks[0](event); await settle();
    expect(s.sendNotificationSignal).toHaveBeenCalledTimes(2); expect(warning).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warning.mock.calls)).not.toContain("private notification contents"); s.provider.stop();
  });
});

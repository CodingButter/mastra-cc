import { describe, expect, it, vi } from "vitest";
import { DeskCache } from "../desk-cache";

describe("DeskCache", () => {
  it("reuses a healthy instance", () => {
    const create = vi.fn(() => ({}));
    const cache = new DeskCache(create);
    expect(cache.get()).toBe(cache.get());
    expect(create).toHaveBeenCalledOnce();
  });

  it("replaces only the instance that was invalidated", () => {
    const create = vi.fn(() => ({}));
    const cache = new DeskCache(create);
    const first = cache.get();
    cache.invalidate(first);
    const second = cache.get();
    expect(second).not.toBe(first);
    cache.invalidate(first);
    expect(cache.get()).toBe(second);
    expect(create).toHaveBeenCalledTimes(2);
  });
});

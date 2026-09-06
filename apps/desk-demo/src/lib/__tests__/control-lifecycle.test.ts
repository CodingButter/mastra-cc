import { afterEach, describe, expect, it, vi } from "vitest";
import { controlState, requestControl, release } from "../control";

afterEach(() => {
  const id = controlState().requestId;
  if (id) release(id);
  vi.useRealTimers();
});

describe("human control outlives the agent's waiter", () => {
  it("rejects on timeout without locking the desk, and still accepts Done", async () => {
    vi.useFakeTimers();
    const { requestId, done } = requestControl("credentials", 100);
    const rejected = expect(done).rejects.toThrow("person still has control");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(controlState()).toMatchObject({ mode: "interact", requestId });
    expect(release(requestId)).toBe(true);
    expect(controlState().mode).toBe("view");
    await expect(done).rejects.toThrow("timed out");
  });

  it("cancels the waiter without taking the person's keyboard", async () => {
    const abort = new AbortController();
    const { requestId, done } = requestControl("credentials", 1000, abort.signal);
    abort.abort();
    await expect(done).rejects.toThrow("cancelled");
    expect(controlState()).toMatchObject({ mode: "interact", requestId });
    expect(release(requestId)).toBe(true);
  });

  it("only resolves a live waiter when the person presses Done", async () => {
    const { requestId, done } = requestControl("credentials", 1000);
    expect(release("wrong-request")).toBe(false);
    expect(controlState().mode).toBe("interact");
    expect(release(requestId, "finished")).toBe(true);
    await expect(done).resolves.toBe("finished");
  });
});

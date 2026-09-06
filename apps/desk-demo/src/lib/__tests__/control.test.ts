import { afterEach, describe, expect, it, vi } from "vitest";
import { controlState, release, requestControl } from "../control";

afterEach(() => {
  const id = controlState().requestId;
  if (id) release(id);
  vi.useRealTimers();
});

describe("human control", () => {
  it("times out the waiter without taking back the person's control", async () => {
    vi.useFakeTimers();
    const { requestId, done } = requestControl("sign in", 100);
    const rejected = expect(done).rejects.toThrow("person still has control");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(controlState()).toMatchObject({ mode: "interact", requestId });
    expect(release("wrong-id")).toBe(false);
    expect(controlState().mode).toBe("interact");
    expect(release(requestId)).toBe(true);
    expect(controlState().mode).toBe("view");
  });

  it("cancels the wait without manufacturing human consent", async () => {
    const abort = new AbortController();
    const { requestId, done } = requestControl("sign in", 1000, abort.signal);
    const rejected = expect(done).rejects.toThrow("cancelled");
    abort.abort();
    await rejected;
    expect(controlState()).toMatchObject({ mode: "interact", requestId });
  });

  it("only resolves after the person presses Done", async () => {
    const { requestId, done } = requestControl("sign in", 1000);
    expect(release(requestId)).toBe(true);
    await expect(done).resolves.toBe("the person says they are done");
  });

  it("does not grant control for a turn already cancelled", () => {
    const abort = new AbortController();
    abort.abort();
    expect(() => requestControl("sign in", 1000, abort.signal)).toThrow();
    expect(controlState().mode).toBe("view");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A SILENT APPLICATION IS REFUSED IN TIME (ADR-0117).
//
// A frozen application never answers the accessibility bus. dbus-native's own
// NoReply fires at 25s, and the daemon's request chain waits on every call, so
// every client waited that long. This drives the live channel against a bus
// that never replies: the call must reject at the 10s deadline, name what went
// quiet, say whether an effect may have landed, and leave no reply handler
// behind to answer a caller who already gave up.

const calls: Array<{ member: string; timeout: number | undefined; cb: (err: unknown, ...r: unknown[]) => void }> = [];

function silentBus() {
  return {
    connection: { on() {}, removeListener() {}, end() {}, message() {} },
    // Answers GetAddress so the channel can open the accessibility bus, then
    // goes silent - except it honours the deadline it is given, exactly as
    // dbus-native does, by settling with its TimeoutError at that moment.
    invoke(msg: { member: string }, opts: { timeout?: number } | ((...a: unknown[]) => void), cb?: (err: unknown, ...r: unknown[]) => void) {
      const callback = typeof opts === "function" ? opts : cb!;
      const timeout = typeof opts === "function" ? undefined : opts.timeout;
      calls.push({ member: msg.member, timeout, cb: callback });
      if (msg.member === "GetAddress") return callback(null, "unix:path=/fake");
      const deadline = timeout ?? 25_000;
      setTimeout(() => {
        const err = new Error(`No reply within ${deadline}ms`);
        err.name = "TimeoutError";
        callback(err);
      }, deadline);
    },
  };
}

vi.mock("dbus-native", () => ({
  default: { sessionBus: () => silentBus(), createClient: () => silentBus() },
}));

const { liveChannel, ATSPI_CALL_DEADLINE_MS, AtspiDeadlineError } = await import("../channel.js");
const { CallDeadlineError } = await import("../../../backend.js");

describe("a silent application is refused in time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calls.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("the deadline is 10s, well inside the bus's own 25s", () => {
    expect(ATSPI_CALL_DEADLINE_MS).toBe(10_000);
  });

  it("a read that is never answered rejects at 10s and changed nothing", async () => {
    const channel = liveChannel();
    const call = channel.call({ destination: ":1.9", path: "/a", iface: "org.a11y.atspi.Accessible", member: "GetChildren" });
    const outcome = call.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(9_999);
    let settled = false;
    void outcome.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await outcome;
    expect(error).toBeInstanceOf(AtspiDeadlineError);
    expect(error).toBeInstanceOf(CallDeadlineError);
    expect((error as InstanceType<typeof CallDeadlineError>).effectSent).toBe(false);
    expect((error as Error).message).toBe('the application did not answer "org.a11y.atspi.Accessible.GetChildren" within 10s');
    expect(calls.find((c) => c.member === "GetChildren")?.timeout).toBe(10_000);
  });

  it("an effect that is never answered is UNKNOWN, not unchanged", async () => {
    const channel = liveChannel();
    const outcome = channel
      .call({ destination: ":1.9", path: "/a", iface: "org.a11y.atspi.Action", member: "DoAction", signature: "i", body: [0] })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    const error = (await outcome) as InstanceType<typeof CallDeadlineError>;
    expect(error).toBeInstanceOf(AtspiDeadlineError);
    expect(error.effectSent).toBe(true);
  });

  it("the session bus's own lookup is bounded too", async () => {
    liveChannel().call({ destination: ":1.9", path: "/a", iface: "x", member: "GetState" }).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.find((c) => c.member === "GetAddress")?.timeout).toBe(10_000);
  });
});

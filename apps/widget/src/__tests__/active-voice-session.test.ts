import { describe, expect, it, vi } from "vitest";

import { createActiveVoiceSession } from "../voice/active-session.js";

describe("active voice conversation", () => {
  it("sends follow-up speech without another wake and reports actual speech", () => {
    const said = vi.fn();
    const session = createActiveVoiceSession({ said, closeProvider: vi.fn(), resetWake: vi.fn() });

    session.admit();
    expect(session.heard("what about tomorrow?")).toBe(false);
    expect(said).toHaveBeenCalledTimes(1);
  });

  it("re-arms wake when the hub closes an active session without echoing another close", () => {
    const closeHubSession = vi.fn();
    const closeProvider = vi.fn();
    const resetWake = vi.fn();
    const session = createActiveVoiceSession({
      said: vi.fn(),
      closeHubSession,
      closeProvider,
      resetWake,
    });

    session.admit();
    session.hubClosed();

    expect(session.state()).toBe("idle");
    expect(resetWake).toHaveBeenCalledOnce();
    expect(closeProvider).toHaveBeenCalledOnce();
    expect(closeHubSession).not.toHaveBeenCalled();
  });

  it("dismisses provisional and active sessions without cancelling work or disarming wake", () => {
    const closeProvider = vi.fn();
    const resetWake = vi.fn();
    const session = createActiveVoiceSession({ said: vi.fn(), closeProvider, resetWake });

    expect(session.dismiss("never mind", "provisional")).toBe(true);
    expect(resetWake).toHaveBeenCalledTimes(1);
    expect(closeProvider).toHaveBeenCalledTimes(1);

    session.admit();
    expect(session.dismiss("stop", "active")).toBe(true);
    expect(session.dismiss("stop", "active")).toBe(true);
    expect(resetWake).toHaveBeenCalledTimes(3);
    expect(closeProvider).toHaveBeenCalledTimes(2);
    expect(session.state()).toBe("idle");
  });
});

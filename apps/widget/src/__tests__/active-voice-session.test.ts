import { describe, expect, it, vi } from "vitest";

import { createActiveVoiceSession } from "../voice/active-session.js";

describe("active voice conversation", () => {
  it("sends follow-up speech without wake or directedness and reports actual speech", () => {
    const said = vi.fn();
    const classifyDirectedness = vi.fn();
    const session = createActiveVoiceSession({ said, closeProvider: vi.fn(), discardProvisional: vi.fn() });

    session.admit();
    expect(session.heard("what about tomorrow?")).toBe(false);
    expect(said).toHaveBeenCalledTimes(1);
    expect(classifyDirectedness).not.toHaveBeenCalled();
  });

  it("dismisses provisional and active sessions without cancelling work or disarming wake", () => {
    const closeProvider = vi.fn();
    const discardProvisional = vi.fn();
    const session = createActiveVoiceSession({ said: vi.fn(), closeProvider, discardProvisional });

    expect(session.dismiss("never mind", "provisional")).toBe(true);
    expect(discardProvisional).toHaveBeenCalledTimes(1);
    expect(closeProvider).not.toHaveBeenCalled();

    session.admit();
    expect(session.dismiss("stop", "active")).toBe(true);
    expect(session.dismiss("stop", "active")).toBe(true);
    expect(closeProvider).toHaveBeenCalledTimes(1);
    expect(session.state()).toBe("idle");
  });
});

import { describe, expect, it, vi } from "vitest";

import { VOICE_SESSION_INACTIVITY_MS, createVoiceSessionOwner } from "../voice/session.js";

describe("voice session inactivity", () => {
  it("keeps the production inactivity window at exactly sixty seconds", () => {
    expect(VOICE_SESSION_INACTIVITY_MS).toBe(60_000);
  });

  it("refreshes only for actual speech and closes exactly once after silence", () => {
    let now = 0;
    const close = vi.fn();
    const owner = createVoiceSessionOwner({ now: () => now, close });

    owner.open("session-1");
    now = 30_000;
    owner.activity("heartbeat");
    owner.activity("gate");
    owner.activity("model-output");
    expect(owner.sweep()).toBe(false);

    owner.activity("speech");
    now = 89_999;
    expect(owner.sweep()).toBe(false);
    now = 90_000;
    expect(owner.sweep()).toBe(true);
    expect(owner.sweep()).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith("session-1", "inactivity");
  });
});

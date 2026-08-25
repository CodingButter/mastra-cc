export const VOICE_SESSION_INACTIVITY_MS = 60_000;

export type VoiceSessionActivity = "speech" | "heartbeat" | "gate" | "model-output" | "traffic";

export function createVoiceSessionOwner(options: Readonly<{
  now?: () => number;
  close(session: string, reason: "inactivity"): void;
  inactivityMs?: number;
}>) {
  const now = options.now ?? Date.now;
  const inactivityMs = options.inactivityMs ?? VOICE_SESSION_INACTIVITY_MS;
  const sessions = new Set<string>();
  let lastSpeechAt = now();

  return {
    open(session: string): void {
      sessions.add(session);
      lastSpeechAt = now();
    },
    close(session: string): void {
      sessions.delete(session);
    },
    activity(kind: VoiceSessionActivity): void {
      if (kind === "speech") lastSpeechAt = now();
    },
    sweep(): boolean {
      if (sessions.size === 0 || now() - lastSpeechAt < inactivityMs) return false;
      const expired = [...sessions];
      sessions.clear();
      for (const session of expired) options.close(session, "inactivity");
      return expired.length > 0;
    },
    get size() {
      return sessions.size;
    },
  };
}

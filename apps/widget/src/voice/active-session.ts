import { isSpokenDismissal } from "../hiding-model.js";

export type VoiceConversationState = "idle" | "provisional" | "active";

export function createActiveVoiceSession(options: Readonly<{
  said(): void;
  openHubSession?(): void;
  closeHubSession?(): void;
  closeProvider(): void;
  resetWake(): void;
}>) {
  let phase: VoiceConversationState = "idle";
  let providerClosed = false;

  const close = (
    from: Exclude<VoiceConversationState, "idle"> = phase === "active" ? "active" : "provisional",
    notifyHub = true,
  ): void => {
    options.resetWake();
    if (!providerClosed) {
      providerClosed = true;
      options.closeProvider();
      if (from === "active" && notifyHub) options.closeHubSession?.();
    }
    phase = "idle";
  };

  const dismiss = (utterance: string, from?: Exclude<VoiceConversationState, "idle">): boolean => {
    if (!isSpokenDismissal(utterance)) return false;
    close(from);
    return true;
  };

  return {
    admit(): void {
      phase = "active";
      providerClosed = false;
      options.openHubSession?.();
    },
    heard(utterance: string): boolean {
      if (phase !== "active") return false;
      if (dismiss(utterance, "active")) return true;
      options.said();
      return false;
    },
    dismiss,
    close,
    hubClosed(): void {
      if (phase !== "idle") close(phase, false);
    },
    state: () => phase,
  };
}

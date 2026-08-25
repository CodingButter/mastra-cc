import { isSpokenDismissal } from "../hiding-model.js";

export type VoiceConversationState = "idle" | "provisional" | "active";

export function createActiveVoiceSession(options: Readonly<{
  said(): void;
  openHubSession?(): void;
  closeHubSession?(): void;
  closeProvider(): void;
  discardProvisional(): void;
}>) {
  let phase: VoiceConversationState = "idle";
  let providerClosed = false;

  const close = (from: Exclude<VoiceConversationState, "idle"> = phase === "active" ? "active" : "provisional"): void => {
    if (from === "provisional") options.discardProvisional();
    else if (!providerClosed) {
      providerClosed = true;
      options.closeProvider();
      options.closeHubSession?.();
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
    state: () => phase,
  };
}

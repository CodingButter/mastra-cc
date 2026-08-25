import type { VoiceDialResult } from "@mastra-cc/transport";

const CONSTRAINED_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const SETUP_TIMEOUT_MS = 15_000;

type DialTicket = Pick<Extract<VoiceDialResult, { ok: true }>, "token" | "model">;

export interface ProviderSocket {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  send(data: string): void;
  close(): void;
}

export interface MicrophoneSource {
  subscribe(listener: (samples: Int16Array) => void): () => void;
}

export function createMicrophoneSource(): MicrophoneSource & { push(samples: Int16Array): void } {
  const listeners = new Set<(samples: Int16Array) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push(samples) {
      for (const listener of listeners) listener(samples);
    },
  };
}

function audioFrame(samples: Int16Array): string {
  const bytes = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  return JSON.stringify({
    realtimeInput: {
      audio: { mimeType: "audio/pcm;rate=16000", data: bytes.toString("base64") },
    },
  });
}

export function createProviderSession(options: Readonly<{
  socketFactory?: (url: string) => ProviderSocket;
  setupTimeoutMs?: number;
  onInputTranscript?: (text: string) => void;
}> = {}) {
  const socketFactory = options.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as ProviderSocket);
  let socket: ProviderSocket | undefined;
  let openingQueued = false;
  let stopContinuation: (() => void) | undefined;
  let closed = false;

  return {
    async open(ticket: DialTicket): Promise<void> {
      if (socket !== undefined) throw new Error("provider session is already open");
      closed = false;
      const next = socketFactory(`${CONSTRAINED_ENDPOINT}?access_token=${encodeURIComponent(ticket.token)}`);
      socket = next;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          next.removeEventListener("open", onOpen);
          next.removeEventListener("message", onMessage);
          next.removeEventListener("close", onClose);
          next.removeEventListener("error", onError);
          if (error) reject(error);
          else resolve();
        };
        const onOpen = () => next.send(JSON.stringify({ setup: { model: `models/${ticket.model}` } }));
        const onMessage = (event: unknown) => {
          try {
            const message = JSON.parse(String((event as { data?: unknown }).data));
            if (message && typeof message === "object" && "setupComplete" in message) finish();
          } catch {
            // A malformed provider frame is not setup completion.
          }
        };
        const onClose = () => finish(new Error("provider socket closed before setup completed"));
        const onError = () => finish(new Error("provider socket failed before setup completed"));
        const timeout = setTimeout(
          () => finish(new Error(`provider did not complete setup within ${options.setupTimeoutMs ?? SETUP_TIMEOUT_MS}ms`)),
          options.setupTimeoutMs ?? SETUP_TIMEOUT_MS,
        );
        next.addEventListener("open", onOpen);
        next.addEventListener("message", onMessage);
        next.addEventListener("close", onClose);
        next.addEventListener("error", onError);
      });
      next.addEventListener("message", (event: unknown) => {
        try {
          const message = JSON.parse(String((event as { data?: unknown }).data)) as {
            serverContent?: { inputTranscription?: { text?: unknown } };
          };
          const text = message.serverContent?.inputTranscription?.text;
          if (typeof text === "string" && text.trim() !== "") options.onInputTranscript?.(text);
        } catch {
          // A malformed provider frame is a frame we never heard.
        }
      });
    },

    async enqueuePcm(opening: Int16Array): Promise<void> {
      if (openingQueued) throw new Error("provider opening was already queued");
      if (socket === undefined || closed) throw new Error("provider session is not open");
      socket.send(audioFrame(opening));
      openingQueued = true;
    },

    startLiveContinuation(source: MicrophoneSource): void {
      if (!openingQueued) throw new Error("provider opening must be queued before live continuation starts");
      if (stopContinuation !== undefined) throw new Error("provider live continuation already started");
      stopContinuation = source.subscribe((samples) => {
        if (socket === undefined || closed) return;
        socket.send(audioFrame(samples));
      });
    },

    close(): void {
      if (closed) return;
      closed = true;
      stopContinuation?.();
      stopContinuation = undefined;
      socket?.close();
      socket = undefined;
      openingQueued = false;
    },
  };
}

import type { VoiceDialResult } from "@mastra-cc/transport";

import type { SignalBatch } from "./signal-scheduler.js";

const CONSTRAINED_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const SETUP_TIMEOUT_MS = 15_000;
const MAX_PROVISIONAL_AUDIO_CHUNKS = 2_048;
const MAX_PROVISIONAL_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_PROVISIONAL_AUDIO_CHUNK_BYTES = 64 * 1024;
const MAX_PROVISIONAL_AUDIO_ENCODED_CHARS = Math.ceil(MAX_PROVISIONAL_AUDIO_CHUNK_BYTES / 3) * 4;
const DISMISSAL_TRANSCRIPT_SETTLE_MS = 350;

export const ADMIT_CONVERSATION_TOOL = "admit_conversation";
export const STOP_LISTENING_TOOL = "stop_listening";
export const REALTIME_ADMISSION_INSTRUCTION = [
  "You are Mastra's realtime conversational voice. You have no desktop tools and no execution authority.",
  "The opening audio follows a local phrase wake and may still be incidental speech.",
  "Remain completely silent unless the user is unmistakably addressing Mastra.",
  `A direct request such as "Hey Mastra, tell me a fact about Saturn" is unmistakably addressed to Mastra: call ${ADMIT_CONVERSATION_TOOL} and answer.`,
  `Speech such as "Hey Mastra... Jessica, did you move my charger?" is addressed to Jessica: call ${STOP_LISTENING_TOOL} and remain silent.`,
  `For every unmistakably direct request, call ${ADMIT_CONVERSATION_TOOL} before producing audio.`,
  `If incidental, addressed elsewhere, ambiguous, or dismissed, call ${STOP_LISTENING_TOOL} and remain silent.`,
  "After admission, send requests to the background orchestrator and treat its returned signals as execution truth.",
  "Never claim an action succeeded before an orchestrator signal says it did.",
].join(" ");

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

async function messageText(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  return String(data);
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
  admissionTimeoutMs?: number;
  onAudio?: (chunk: Uint8Array) => void;
  onInputTranscript?: (text: string) => void;
  onModelSpeechStarted?: () => void;
  onModelSpeechFinished?: () => void;
  onAdmitted?: () => void;
  onStopListening?: () => void;
  onTerminalDecision?: (reason: "explicit-admit" | "explicit-stop" | "timeout" | "malformed-control" | "invalid-output" | "provider-failure") => void;
  onClosed?: () => void;
}> = {}) {
  const socketFactory = options.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as ProviderSocket);
  let socket: ProviderSocket | undefined;
  let openingQueued = false;
  let continuationSource: MicrophoneSource | undefined;
  let stopContinuation: (() => void) | undefined;
  let decision: "pending" | "admitted" | "stopped" = "pending";
  let decisionTimer: ReturnType<typeof setTimeout> | undefined;
  let transcriptTimer: ReturnType<typeof setTimeout> | undefined;
  let provisionalAudio: Uint8Array[] = [];
  let provisionalAudioBytes = 0;
  let stopDelivered = false;
  let enqueueTimeoutDecision = () => {};
  let failProvider = () => {};
  let closed = false;

  const cleanup = (closeSocket: boolean) => {
    closed = true;
    if (decisionTimer !== undefined) clearTimeout(decisionTimer);
    decisionTimer = undefined;
    if (transcriptTimer !== undefined) clearTimeout(transcriptTimer);
    transcriptTimer = undefined;
    stopContinuation?.();
    stopContinuation = undefined;
    continuationSource = undefined;
    const current = socket;
    socket = undefined;
    openingQueued = false;
    decision = "pending";
    provisionalAudio = [];
    provisionalAudioBytes = 0;
    stopDelivered = false;
    if (closeSocket) current?.close();
  };

  const beginContinuation = () => {
    if (decision !== "admitted" || continuationSource === undefined || stopContinuation !== undefined) return;
    const providerFailed = failProvider;
    stopContinuation = continuationSource.subscribe((samples) => {
      if (socket === undefined || closed) return;
      try {
        socket.send(audioFrame(samples));
      } catch {
        providerFailed();
      }
    });
  };

  return {
    async open(ticket: DialTicket): Promise<void> {
      if (socket !== undefined) throw new Error("provider session is already open");
      closed = false;
      decision = "pending";
      stopDelivered = false;
      const next = socketFactory(`${CONSTRAINED_ENDPOINT}?access_token=${encodeURIComponent(ticket.token)}`);
      socket = next;
      try {
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
        const onOpen = () => next.send(JSON.stringify({
          setup: {
            model: `models/${ticket.model}`,
            generationConfig: { responseModalities: ["AUDIO"] },
            systemInstruction: { parts: [{ text: REALTIME_ADMISSION_INSTRUCTION }] },
            tools: [{ functionDeclarations: [
              { name: ADMIT_CONVERSATION_TOOL, description: "Admit an opening unmistakably addressed to Mastra.", parameters: { type: "OBJECT", properties: {} } },
              { name: STOP_LISTENING_TOOL, description: "Close silently when speech is incidental, ambiguous, addressed elsewhere, or dismisses Mastra.", parameters: { type: "OBJECT", properties: {} } },
            ] }],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        }));
        const onMessage = async (event: unknown) => {
          try {
            const message = JSON.parse(await messageText((event as { data?: unknown }).data));
            if (message && typeof message === "object" && "setupComplete" in message) finish();
          } catch {
            // A malformed provider frame is not setup completion.
          }
        };
        const onClose = (event: unknown) => {
          const close = event as { code?: unknown; reason?: unknown };
          const code = typeof close.code === "number" ? ` (${close.code})` : "";
          const reason = typeof close.reason === "string" && close.reason !== "" ? `: ${close.reason}` : "";
          finish(new Error(`provider socket closed before setup completed${code}${reason}`));
        };
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
      } catch (error) {
        if (socket === next) cleanup(true);
        throw error;
      }
      const stopDecisionTimer = () => {
        if (decisionTimer === undefined) return;
        clearTimeout(decisionTimer);
        decisionTimer = undefined;
      };
      const admit = () => {
        if (decision !== "pending") return;
        decision = "admitted";
        stopDecisionTimer();
        options.onTerminalDecision?.("explicit-admit");
        beginContinuation();
        options.onAdmitted?.();
        if (closed || socket !== next) return;
        if (provisionalAudio.length > 0) options.onModelSpeechStarted?.();
        for (const chunk of provisionalAudio) {
          if (closed || socket !== next) break;
          options.onAudio?.(chunk);
        }
        provisionalAudio = [];
        provisionalAudioBytes = 0;
      };
      const reportInvalidOutput = (cause: string, details: Record<string, number> = {}) => {
    console.warn(JSON.stringify({ type: "provider-session", event: "invalid-output", cause, ...details }));
  };

  const stopProvisionally = (reason: "explicit-stop" | "malformed-control" | "invalid-output") => {
        if (decision !== "pending") return;
        decision = "stopped";
        stopDecisionTimer();
        provisionalAudio = [];
        provisionalAudioBytes = 0;
        options.onTerminalDecision?.(reason);
        options.onStopListening?.();
      };
      const providerFailed = () => {
        if (closed || socket !== next) return;
        if (decision === "pending") options.onTerminalDecision?.("provider-failure");
        cleanup(false);
        options.onClosed?.();
      };
      failProvider = providerFailed;
      next.addEventListener("close", providerFailed);
      next.addEventListener("error", providerFailed);
      let messageQueue = Promise.resolve();
      enqueueTimeoutDecision = () => {
        messageQueue = messageQueue.then(() => {
          if (closed || socket !== next || decision !== "pending") return;
          decision = "stopped";
          decisionTimer = undefined;
          provisionalAudio = [];
          provisionalAudioBytes = 0;
          options.onTerminalDecision?.("timeout");
          options.onStopListening?.();
        });
      };
      next.addEventListener("message", (event: unknown) => {
        const data = (event as { data?: unknown }).data;
        messageQueue = messageQueue.then(async () => {
          try {
            if (closed || socket !== next) return;
            const message = JSON.parse(await messageText(data)) as {
            serverContent?: {
              inputTranscription?: { text?: unknown };
              modelTurn?: { parts?: Array<{ inlineData?: { mimeType?: unknown; data?: unknown } }> };
              turnComplete?: unknown;
            };
            toolCall?: { functionCalls?: Array<{ id?: unknown; name?: unknown }> };
          };
          const decodedAudio: Uint8Array[] = [];
          for (const part of message.serverContent?.modelTurn?.parts ?? []) {
            const inline = part.inlineData;
            if (typeof inline?.mimeType !== "string" || !inline.mimeType.startsWith("audio/pcm")) continue;
            if (
              typeof inline.data !== "string" ||
              inline.data.length === 0 ||
              inline.data.length > MAX_PROVISIONAL_AUDIO_ENCODED_CHARS ||
              !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(inline.data)
            ) {
              reportInvalidOutput("encoded-field", {
                encodedLength: typeof inline.data === "string" ? inline.data.length : -1,
              });
              if (decision === "pending") stopProvisionally("invalid-output");
              else providerFailed();
              return;
            }
            let chunk = Buffer.from(inline.data, "base64");
            if (
              chunk.toString("base64") !== inline.data ||
              chunk.byteLength === 0 ||
              chunk.byteLength > MAX_PROVISIONAL_AUDIO_CHUNK_BYTES
            ) {
              reportInvalidOutput("decoded-chunk", {
                encodedLength: inline.data.length,
                decodedLength: chunk.byteLength,
              });
              if (decision === "pending") stopProvisionally("invalid-output");
              else providerFailed();
              return;
            }
            if (chunk.byteLength % 2 !== 0) chunk = chunk.subarray(0, chunk.byteLength - 1);
            if (chunk.byteLength === 0) {
              reportInvalidOutput("empty-after-alignment", { encodedLength: inline.data.length });
              if (decision === "pending") stopProvisionally("invalid-output");
              else providerFailed();
              return;
            }
            decodedAudio.push(chunk);
          }
          const decodedAudioBytes = decodedAudio.reduce((total, chunk) => total + chunk.byteLength, 0);
          if (
            decodedAudio.length > MAX_PROVISIONAL_AUDIO_CHUNKS ||
            decodedAudioBytes > MAX_PROVISIONAL_AUDIO_BYTES ||
            (decision === "pending" &&
              (provisionalAudio.length + decodedAudio.length > MAX_PROVISIONAL_AUDIO_CHUNKS ||
                provisionalAudioBytes + decodedAudioBytes > MAX_PROVISIONAL_AUDIO_BYTES))
          ) {
            reportInvalidOutput("frame-or-aggregate-limit", {
              frameChunks: decodedAudio.length,
              frameBytes: decodedAudioBytes,
              bufferedChunks: provisionalAudio.length,
              bufferedBytes: provisionalAudioBytes,
            });
            if (decision === "pending") stopProvisionally("invalid-output");
            else providerFailed();
            return;
          }
          const controls = message.toolCall?.functionCalls ?? [];
          if (controls.length > 0) {
            const call = controls[0]!;
            if (
              controls.length !== 1 ||
              typeof call.id !== "string" ||
              call.id.length === 0 ||
              (call.name !== ADMIT_CONVERSATION_TOOL && call.name !== STOP_LISTENING_TOOL)
            ) {
              if (decision === "pending") stopProvisionally("malformed-control");
              return;
            } else {
              try {
                next.send(JSON.stringify({ toolResponse: { functionResponses: [{ id: call.id, name: call.name, response: { ok: true } }] } }));
              } catch {
                providerFailed();
                return;
              }
              if (call.name === ADMIT_CONVERSATION_TOOL && decision === "pending") {
                admit();
              } else if (call.name === STOP_LISTENING_TOOL && !stopDelivered) {
                stopDelivered = true;
                if (decision === "pending") {
                  decision = "stopped";
                  stopDecisionTimer();
                  provisionalAudio = [];
                  provisionalAudioBytes = 0;
                  options.onTerminalDecision?.("explicit-stop");
                }
                options.onStopListening?.();
                return;
              }
            }
          }
          if (closed || socket !== next) return;
          const transcript = message.serverContent?.inputTranscription?.text;
          if (typeof transcript === "string" && transcript.trim() !== "") {
            if (transcriptTimer !== undefined) clearTimeout(transcriptTimer);
            transcriptTimer = setTimeout(() => {
              transcriptTimer = undefined;
              if (closed || socket !== next) return;
              options.onInputTranscript?.(transcript);
            }, DISMISSAL_TRANSCRIPT_SETTLE_MS);
          }
          for (const chunk of decodedAudio) {
            if (decision === "stopped") continue;
            if (decision === "pending") {
              if (
                provisionalAudio.length >= MAX_PROVISIONAL_AUDIO_CHUNKS ||
                provisionalAudioBytes + chunk.byteLength > MAX_PROVISIONAL_AUDIO_BYTES
              ) {
                stopProvisionally("invalid-output");
              } else {
                provisionalAudio.push(chunk);
                provisionalAudioBytes += chunk.byteLength;
              }
              continue;
            }
            if (closed || socket !== next) return;
            options.onModelSpeechStarted?.();
            if (closed || socket !== next) return;
            options.onAudio?.(chunk);
          }
          if (closed || socket !== next) return;
          if (decision === "admitted" && message.serverContent?.turnComplete === true) options.onModelSpeechFinished?.();
          } catch {
            stopProvisionally("malformed-control");
          }
        });
      });
    },

    async enqueuePcm(opening: Int16Array): Promise<void> {
      if (openingQueued) throw new Error("provider opening was already queued");
      const current = socket;
      if (current === undefined || closed) throw new Error("provider session is not open");
      openingQueued = true;
      try {
        for (let offset = 0; offset < opening.length; offset += 320) {
          current.send(audioFrame(opening.subarray(offset, offset + 320)));
        }
        current.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      } catch (error) {
        if (decision === "pending") options.onTerminalDecision?.("provider-failure");
        cleanup(true);
        options.onClosed?.();
        throw error;
      }
      decisionTimer = setTimeout(enqueueTimeoutDecision, options.admissionTimeoutMs ?? SETUP_TIMEOUT_MS);
    },

    startLiveContinuation(source: MicrophoneSource): void {
      if (!openingQueued) throw new Error("provider opening must be queued before live continuation starts");
      if (continuationSource !== undefined) throw new Error("provider live continuation already started");
      continuationSource = source;
      beginContinuation();
    },

    sendSignals(batch: SignalBatch): void {
      const current = socket;
      if (current === undefined || closed) return;
      const providerFailed = failProvider;
      const text = [
        "Background orchestrator update. Treat this as execution truth; do not claim anything beyond it.",
        ...batch.signals.map((signal) => `- [${signal.priority}] ${signal.detail}`),
        batch.delivery === "automatic"
          ? "Mention this only if it is useful to the user now."
          : "Use this as private context for the user's current turn; do not mention it unless relevant.",
      ].join("\n");
      try {
        current.send(JSON.stringify({
          clientContent: {
            turns: [{ role: "user", parts: [{ text }] }],
            turnComplete: batch.delivery === "automatic",
          },
        }));
      } catch {
        providerFailed();
      }
    },

    close(): void {
      if (closed && socket === undefined) return;
      cleanup(true);
    },
  };
}

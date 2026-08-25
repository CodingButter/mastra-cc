import { createConnection, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";

// THE LANE WIRE (ADR-0052) - transport's second wire, and its fifth
// responsibility.
//
// This is NOT the daemon wire. Different peer, different vocabulary, no digest
// handshake: the daemon wire's digest works because both ends are generated
// from `protocol/schema.json`, and the lane vocabulary is not generated. Its
// equivalent guarantee is below - a frame naming an event outside the frozen
// four is refused where it arrives instead of being handed to a renderer that
// will do something with it.
//
// WHY THE VOCABULARY IS DECLARED HERE and not in the hub, where it was born:
// the carrier is the lowest layer that must know the four names, and both ends
// need them. The hub sits above this package and imports it; this package
// cannot import the hub back. The alternative was a second copy of four strings
// on the client side, which is the three-copy problem ADR-0003 exists to
// prevent, arriving as a four-string version of itself. So there is exactly one
// declaration and both ends import it. The hub's own test still asserts the SET
// against `docs/01-ARCHITECTURE.md`, so the words are still pinned to the
// document rather than to whichever file happens to hold them.

/**
 * The vocabulary, verbatim from `docs/01-ARCHITECTURE.md:125-128` including the
 * meanings, because the meaning is the part that drifted.
 *
 * - `progress` - the agent is working; here is what it is doing
 * - `answer` - the agent has something to say to the person
 * - `voice_opened` - a voice session became active somewhere
 * - `voice_closed` - the last voice session ended
 */
export const LANE_EVENTS = ["progress", "answer", "voice_opened", "voice_closed"] as const;
export type LaneEvent = (typeof LANE_EVENTS)[number];

export interface LaneFrame {
  readonly event: LaneEvent;
  /** What the agent is doing, or has to say. Absent on the voice edges, which carry no prose. */
  readonly detail?: string;
}

export const DIRECTEDNESS_MAX_AUDIO_BYTES = 384_000;
export const DIRECTEDNESS_TIMEOUT_MS = 10_000;
export type DirectednessVerdict = "directed" | "incidental" | "uncertain";
export type DirectednessReason =
  | "addressed-mastra"
  | "addressed-elsewhere"
  | "unconfigured"
  | "unsupported-provider"
  | "provider-refused"
  | "malformed-answer"
  | "timeout"
  | "invalid-request";

export interface DirectednessRequest {
  readonly type: "directedness_request";
  readonly id: string;
  readonly format: { readonly sampleRate: 16_000; readonly channels: 1; readonly sampleFormat: "s16le" };
  readonly audioBase64: string;
}

export interface DirectednessResult {
  readonly type: "directedness_result";
  readonly id: string;
  readonly verdict: DirectednessVerdict;
  readonly reason: DirectednessReason;
}

export interface DirectednessOpening {
  readonly audio: Int16Array;
  readonly sampleRate: 16_000;
  readonly channels: 1;
  readonly sampleFormat: "s16le";
}

export interface VoiceDialRequest {
  readonly type: "voice_dial_request";
  readonly id: string;
}

export type VoiceDialResult =
  | { readonly type: "voice_dial_result"; readonly id: string; readonly ok: true; readonly token: string; readonly model: string }
  | {
      readonly type: "voice_dial_result";
      readonly id: string;
      readonly ok: false;
      readonly status: number;
      readonly code: string;
      readonly refusal: string;
    };

/** True when a parsed line is a frame this wire is allowed to deliver. */
export function isLaneFrame(value: unknown): value is LaneFrame {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as { event?: unknown; detail?: unknown };
  if (!LANE_EVENTS.includes(frame.event as LaneEvent)) return false;
  return frame.detail === undefined || typeof frame.detail === "string";
}

function validRequest(value: unknown): value is DirectednessRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Partial<DirectednessRequest>;
  if (request.type !== "directedness_request" || typeof request.id !== "string" || request.id.length === 0) return false;
  if (typeof request.audioBase64 !== "string" || request.audioBase64.length > Math.ceil(DIRECTEDNESS_MAX_AUDIO_BYTES / 3) * 4) return false;
  const format = request.format;
  if (format?.sampleRate !== 16_000 || format.channels !== 1 || format.sampleFormat !== "s16le") return false;
  const decoded = Buffer.from(request.audioBase64, "base64");
  return decoded.byteLength > 0 && decoded.byteLength <= DIRECTEDNESS_MAX_AUDIO_BYTES && decoded.byteLength % 2 === 0;
}

function validResult(value: unknown): value is DirectednessResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Partial<DirectednessResult>;
  return (
    result.type === "directedness_result" &&
    typeof result.id === "string" &&
    (["directed", "incidental", "uncertain"] as const).includes(result.verdict as DirectednessVerdict) &&
    ([
      "addressed-mastra",
      "addressed-elsewhere",
      "unconfigured",
      "unsupported-provider",
      "provider-refused",
      "malformed-answer",
      "timeout",
      "invalid-request",
    ] as const).includes(result.reason as DirectednessReason)
  );
}

function validVoiceDialRequest(value: unknown): value is VoiceDialRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Partial<VoiceDialRequest>;
  return request.type === "voice_dial_request" && typeof request.id === "string" && request.id.length > 0;
}

function validVoiceDialResult(value: unknown): value is VoiceDialResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Partial<VoiceDialResult>;
  if (result.type !== "voice_dial_result" || typeof result.id !== "string" || typeof result.ok !== "boolean") return false;
  if (result.ok) return typeof result.token === "string" && result.token.length > 0 && typeof result.model === "string" && result.model.length > 0;
  const refusal = result as Partial<Extract<VoiceDialResult, { ok: false }>>;
  return typeof refusal.status === "number" && typeof refusal.code === "string" && typeof refusal.refusal === "string";
}

/**
 * What the server end needs from the hub. Structural on purpose: this package
 * sits below the hub and must not import it, and the hub's `LaneHub` satisfies
 * this without knowing the wire exists.
 */
export interface LaneSource {
  join(deliver: (frame: LaneFrame) => void, ping?: () => void): {
    pong(): void;
    said(): void;
    classifyDirectedness?(request: DirectednessRequest): Promise<DirectednessResult>;
    mintVoiceDial?(request: VoiceDialRequest): Promise<VoiceDialResult>;
    openVoiceSession?(): void;
    closeVoiceSession?(): void;
    readonly open: boolean;
  };
}

export interface LaneServer {
  /**
   * Write a raw line to every connected client. This exists for the one test
   * that must produce a frame the hub would never send; nothing in the shipped
   * path calls it.
   */
  sendRaw(line: string): void;
  readonly connections: number;
  close(): Promise<void>;
}

export function defaultLaneSocketPath(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR ?? "/tmp";
  return join(runtimeDir, "mastra-cc", "lane.sock");
}

export interface LaneClient {
  /** The peer said something a person caused. Not a pong - the hub's clock only moves for this. */
  said(): void;
  classifyDirectedness(opening: DirectednessOpening, signal?: AbortSignal): Promise<DirectednessResult>;
  /** Ask the hub to mint one provider ticket for this client to dial directly. */
  mintVoiceDial(signal?: AbortSignal): Promise<VoiceDialResult>;
  openVoiceSession(): void;
  closeVoiceSession(): void;
  readonly connected: boolean;
  close(): Promise<void>;
}

export async function serveLane(options: {
  source: LaneSource;
  socketPath: string;
}): Promise<LaneServer> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    // The joining client is handed the current state by the hub, on this
    // socket alone (PR #230). Deleting the delivery here loses the edge for
    // every late joiner while every test that connects first stays green.
    const connection = options.source.join(
      (frame) => socket.write(`${JSON.stringify(frame)}\n`),
      () => socket.write(`${JSON.stringify({ type: "ping" })}\n`),
    );
    let buffer = "";
    const directednessIds = new Set<string>();
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;
        let message: { type?: unknown };
        try {
          message = JSON.parse(line) as { type?: unknown };
        } catch {
          continue;
        }
        // A PONG IS NOT SPEECH, and the distinction is made here because this
        // is where the two arrive on the same socket.
        if (message.type === "pong") connection.pong();
        else if (message.type === "said") connection.said();
        else if (message.type === "directedness_request") {
          const request = message as unknown;
          const id = typeof (request as { id?: unknown }).id === "string" ? (request as { id: string }).id : "invalid";
          if (!validRequest(request) || directednessIds.has(id) || !connection.classifyDirectedness) {
            socket.write(`${JSON.stringify({ type: "directedness_result", id, verdict: "uncertain", reason: "invalid-request" })}\n`);
            continue;
          }
          directednessIds.add(id);
          void connection
            .classifyDirectedness(request)
            .then((result) => socket.write(`${JSON.stringify(result)}\n`))
            .catch(() =>
              socket.write(
                `${JSON.stringify({ type: "directedness_result", id, verdict: "uncertain", reason: "provider-refused" })}\n`,
              ),
            );
        } else if (message.type === "voice_dial_request") {
          const request = message as unknown;
          const id = typeof (request as { id?: unknown }).id === "string" ? (request as { id: string }).id : "invalid";
          if (!validVoiceDialRequest(request) || !connection.mintVoiceDial) {
            socket.write(`${JSON.stringify({ type: "voice_dial_result", id, ok: false, status: 409, code: "UNCONFIGURED", refusal: "voice: this carrier has no dial capability" })}\n`);
            continue;
          }
          void connection.mintVoiceDial(request).then((result) => socket.write(`${JSON.stringify(result)}\n`));
        } else if (message.type === "voice_session_open") {
          connection.openVoiceSession?.();
        } else if (message.type === "voice_session_close") {
          connection.closeVoiceSession?.();
        }
      }
    });
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socketPath, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  return {
    sendRaw(line) {
      for (const socket of sockets) socket.write(line);
    },
    get connections() {
      return sockets.size;
    },
    close() {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function dialLane(options: {
  socketPath: string;
  deliver: (frame: LaneFrame) => void;
  /** Called with the reason a line was not delivered. A client that silently drops is a client that lies. */
  onRefusal?: (reason: string) => void;
}): Promise<LaneClient> {
  const socket = createConnection(options.socketPath);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => {
      socket.removeListener("error", reject);
      resolve();
    });
    socket.once("error", reject);
  });

  let buffer = "";
  let connected = true;
  let nextRequestId = 1;
  const pending = new Map<
    string,
    { resolve: (result: DirectednessResult) => void; timer: ReturnType<typeof setTimeout>; abort?: () => void }
  >();
  const pendingVoiceDials = new Map<
    string,
    { resolve: (result: VoiceDialResult) => void; timer: ReturnType<typeof setTimeout>; abort?: () => void }
  >();
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line) continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        options.onRefusal?.(`lane: peer sent a line that is not JSON - refusing to deliver it`);
        continue;
      }
      if (validResult(message)) {
        const request = pending.get(message.id);
        if (!request) {
          options.onRefusal?.(`lane: refusing a directedness result for unknown id "${message.id}"`);
          continue;
        }
        clearTimeout(request.timer);
        request.abort?.();
        pending.delete(message.id);
        request.resolve(message);
        continue;
      }
      if (validVoiceDialResult(message)) {
        const request = pendingVoiceDials.get(message.id);
        if (!request) {
          options.onRefusal?.(`lane: refusing a voice dial result for unknown id "${message.id}"`);
          continue;
        }
        clearTimeout(request.timer);
        request.abort?.();
        pendingVoiceDials.delete(message.id);
        request.resolve(message);
        continue;
      }
      if ((message as { type?: unknown }).type === "ping") {
        socket.write(`${JSON.stringify({ type: "pong" })}\n`);
        continue;
      }
      // THE VOCABULARY GUARANTEE, at the point of arrival. A frame naming a
      // fifth event is refused here rather than delivered to a renderer that
      // would have to decide what to do with it.
      if (!isLaneFrame(message)) {
        options.onRefusal?.(
          `lane: refusing a frame naming "${String((message as { event?: unknown }).event)}" - ` +
            `the lane vocabulary is exactly ${LANE_EVENTS.join(", ")}`,
        );
        continue;
      }
      options.deliver(message);
    }
  });
  socket.on("close", () => {
    connected = false;
    for (const [id, request] of pending) {
      clearTimeout(request.timer);
      request.abort?.();
      request.resolve({ type: "directedness_result", id, verdict: "uncertain", reason: "provider-refused" });
    }
    pending.clear();
    for (const [id, request] of pendingVoiceDials) {
      clearTimeout(request.timer);
      request.abort?.();
      request.resolve({
        type: "voice_dial_result",
        id,
        ok: false,
        status: 503,
        code: "HUB_UNAVAILABLE",
        refusal: "voice: the hub connection closed before a dial ticket arrived",
      });
    }
    pendingVoiceDials.clear();
  });

  return {
    said() {
      socket.write(`${JSON.stringify({ type: "said" })}\n`);
    },
    openVoiceSession() {
      socket.write(`${JSON.stringify({ type: "voice_session_open" })}\n`);
    },
    closeVoiceSession() {
      socket.write(`${JSON.stringify({ type: "voice_session_close" })}\n`);
    },
    classifyDirectedness(opening, signal) {
      const audio = Buffer.from(opening.audio.buffer, opening.audio.byteOffset, opening.audio.byteLength);
      if (signal?.aborted) {
        return Promise.resolve({
          type: "directedness_result",
          id: "aborted",
          verdict: "uncertain",
          reason: "timeout",
        });
      }
      if (audio.byteLength === 0 || audio.byteLength > DIRECTEDNESS_MAX_AUDIO_BYTES) {
        return Promise.resolve({
          type: "directedness_result",
          id: "invalid",
          verdict: "uncertain",
          reason: "invalid-request",
        });
      }
      const id = `${process.pid}-${nextRequestId++}`;
      return new Promise<DirectednessResult>((resolve) => {
        const finish = (result: DirectednessResult) => {
          const request = pending.get(id);
          if (!request) return;
          clearTimeout(request.timer);
          request.abort?.();
          pending.delete(id);
          resolve(result);
        };
        const timer = setTimeout(
          () => finish({ type: "directedness_result", id, verdict: "uncertain", reason: "timeout" }),
          DIRECTEDNESS_TIMEOUT_MS,
        );
        const abort = signal
          ? () => signal.removeEventListener("abort", onAbort)
          : undefined;
        const onAbort = () =>
          finish({ type: "directedness_result", id, verdict: "uncertain", reason: "timeout" });
        pending.set(id, { resolve, timer, abort });
        signal?.addEventListener("abort", onAbort, { once: true });
        const request: DirectednessRequest = {
          type: "directedness_request",
          id,
          format: {
            sampleRate: opening.sampleRate,
            channels: opening.channels,
            sampleFormat: opening.sampleFormat,
          },
          audioBase64: audio.toString("base64"),
        };
        socket.write(`${JSON.stringify(request)}\n`);
      });
    },
    mintVoiceDial(signal) {
      const id = `${process.pid}-voice-${nextRequestId++}`;
      if (signal?.aborted) {
        return Promise.resolve({
          type: "voice_dial_result",
          id,
          ok: false,
          status: 408,
          code: "ABORTED",
          refusal: "voice: the dial request was cancelled before it was sent",
        });
      }
      return new Promise<VoiceDialResult>((resolve) => {
        const finish = (result: VoiceDialResult) => {
          const request = pendingVoiceDials.get(id);
          if (!request) return;
          clearTimeout(request.timer);
          request.abort?.();
          pendingVoiceDials.delete(id);
          resolve(result);
        };
        const timer = setTimeout(
          () =>
            finish({
              type: "voice_dial_result",
              id,
              ok: false,
              status: 504,
              code: "TIMEOUT",
              refusal: "voice: the hub did not answer the dial request before its deadline",
            }),
          DIRECTEDNESS_TIMEOUT_MS,
        );
        const abort = signal ? () => signal.removeEventListener("abort", onAbort) : undefined;
        const onAbort = () =>
          finish({
            type: "voice_dial_result",
            id,
            ok: false,
            status: 408,
            code: "ABORTED",
            refusal: "voice: the dial request was cancelled",
          });
        pendingVoiceDials.set(id, { resolve, timer, abort });
        signal?.addEventListener("abort", onAbort, { once: true });
        socket.write(`${JSON.stringify({ type: "voice_dial_request", id } satisfies VoiceDialRequest)}\n`);
      });
    },
    get connected() {
      return connected;
    },
    close() {
      return new Promise<void>((resolve) => {
        if (socket.destroyed) return resolve();
        socket.once("close", () => resolve());
        socket.destroy();
      });
    },
  };
}

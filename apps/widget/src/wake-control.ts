import { randomBytes } from "node:crypto";

import type { SpeakerFingerprint } from "@mastra-cc/voice";
import type { TemplateStore } from "@mastra-cc/voice/node";

import { adaptEnrolmentCapture } from "./wake-adapters.js";

const HEARTBEAT_EXPIRY_MS = 6_000;
const INACTIVITY_EXPIRY_MS = 5 * 60_000;

type HeartbeatCommand = Readonly<{ id: number; type: "heartbeat" }>;
type CaptureCommand = Readonly<{ id: number; type: "capture"; takeId: string }>;
type PublishCommand = Readonly<{ id: number; type: "publish"; takeIds: readonly string[] }>;
type ResetCommand = Readonly<{ id: number; type: "reset" }>;
export type WakeControlCommand = HeartbeatCommand | CaptureCommand | PublishCommand | ResetCommand;

type Session = {
  id: string;
  nextCommandId: number;
  lastHeartbeat: number;
  lastActivity: number;
  activeTake?: AbortController;
};

export type WakeControl = Readonly<{
  redeem(nonce: string, origin: string): Readonly<{ session: string }>;
  command(
    session: string,
    origin: string,
    command: WakeControlCommand,
  ): Readonly<{ ok: true }> | Readonly<{ revision: number }> | Promise<Readonly<{ takeId: string }>>;
  sweep(): void;
  expire(): void;
  snapshot(): Readonly<{ takes: readonly string[]; revision: number }>;
}>;

export function createWakeControl(options: Readonly<{
  origin: string;
  nonce: string;
  now?: () => number;
  templates: TemplateStore;
  capture(signal: AbortSignal): Promise<Buffer>;
}>): WakeControl {
  const now = options.now ?? Date.now;
  let bootstrapNonce: string | undefined = options.nonce;
  let session: Session | undefined;
  const takes = new Map<string, SpeakerFingerprint>();

  function expire(): void {
    session?.activeTake?.abort();
    session = undefined;
    takes.clear();
  }

  function requireSession(id: string, origin: string, commandId: number): Session {
    if (origin !== options.origin) throw new Error("wake control origin does not match launched dashboard");
    if (session === undefined || session.id !== id) throw new Error("wake control session is absent or expired");
    if (commandId !== session.nextCommandId) throw new Error("wake control command sequence was replayed or skipped");
    session.nextCommandId += 1;
    session.lastActivity = now();
    return session;
  }

  return {
    redeem(nonce, origin) {
      if (origin !== options.origin) throw new Error("wake control origin does not match launched dashboard");
      if (bootstrapNonce === undefined || nonce !== bootstrapNonce) {
        throw new Error("wake control bootstrap nonce is absent, invalid, or already redeemed");
      }
      bootstrapNonce = undefined;
      session = {
        id: randomBytes(32).toString("hex"),
        nextCommandId: 1,
        lastHeartbeat: now(),
        lastActivity: now(),
      };
      return { session: session.id };
    },
    command(sessionId, origin, command) {
      const active = requireSession(sessionId, origin, command.id);
      if (command.type === "heartbeat") {
        active.lastHeartbeat = now();
        return { ok: true };
      }
      if (command.type === "reset") {
        expire();
        return { ok: true };
      }
      if (command.type === "publish") {
        if (command.takeIds.length !== 5 || new Set(command.takeIds).size !== 5) {
          throw new Error("wake enrolment publishes exactly five distinct selected takes");
        }
        const fingerprints = command.takeIds.map((takeId) => takes.get(takeId));
        if (fingerprints.some((fingerprint) => fingerprint === undefined)) {
          throw new Error("wake enrolment cannot publish a missing take");
        }
        const published = options.templates.publish(fingerprints as readonly SpeakerFingerprint[]);
        expire();
        return { revision: published.revision };
      }

      if (command.takeId.length === 0 || takes.has(command.takeId)) {
        throw new Error("wake enrolment take id must be new and non-empty");
      }
      const abort = new AbortController();
      active.activeTake = abort;
      return options.capture(abort.signal).then((raw) => {
        if (abort.signal.aborted || session !== active) return { takeId: command.takeId };
        const processed = adaptEnrolmentCapture(raw);
        if (processed.fingerprint.length === 0) throw new Error("wake enrolment take contains no phrase");
        takes.set(command.takeId, processed.fingerprint);
        active.activeTake = undefined;
        return { takeId: command.takeId };
      });
    },
    sweep() {
      if (
        session !== undefined &&
        (now() - session.lastHeartbeat >= HEARTBEAT_EXPIRY_MS || now() - session.lastActivity >= INACTIVITY_EXPIRY_MS)
      ) {
        expire();
      }
    },
    expire,
    snapshot() {
      return { takes: [...takes.keys()], revision: options.templates.read().revision };
    },
  };
}

import { describe, expect, it, vi } from "vitest";

import { createMicrophoneSource, createProviderSession, type ProviderSocket } from "../voice/provider-session.js";

class FakeSocket implements ProviderSocket {
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  readyState = 1;

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  emit(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("the constrained provider session", () => {
  it("queues the complete opening once before attaching the existing microphone source", async () => {
    const socket = new FakeSocket();
    const session = createProviderSession({
      socketFactory: (url) => {
        expect(url).toBe(
          "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens%2Fone-use",
        );
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
        return socket;
      },
    });
    const source = createMicrophoneSource();

    await session.open({ token: "auth_tokens/one-use", model: "gemini-live-test" });
    await session.enqueuePcm(new Int16Array([1, -2, 3]));
    session.startLiveContinuation(source);
    source.push(new Int16Array([4, -5]));

    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([
      { setup: { model: "models/gemini-live-test" } },
      { realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: "AQD+/wMA" } } },
      { realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: "BAD7/w==" } } },
    ]);
  });

  it("routes admitted follow-up transcripts without another wake or directedness request", async () => {
    const socket = new FakeSocket();
    const onInputTranscript = vi.fn();
    const session = createProviderSession({
      onInputTranscript,
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
        return socket;
      },
    });

    await session.open({ token: "one-use", model: "gemini-live-test" });
    socket.emit("message", {
      data: JSON.stringify({ serverContent: { inputTranscription: { text: "what about tomorrow?" } } }),
    });

    expect(onInputTranscript).toHaveBeenCalledExactlyOnceWith("what about tomorrow?");
  });

  it("refuses early continuation and duplicate opening handoffs", async () => {
    const socket = new FakeSocket();
    const session = createProviderSession({
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
        return socket;
      },
    });
    const source = createMicrophoneSource();

    await session.open({ token: "one-use", model: "gemini-live-test" });
    expect(() => session.startLiveContinuation(source)).toThrow(/opening must be queued/);
    await session.enqueuePcm(new Int16Array([1]));
    await expect(session.enqueuePcm(new Int16Array([2]))).rejects.toThrow(/already queued/);
  });
});

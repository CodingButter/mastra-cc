import { describe, expect, it, vi } from "vitest";

import { createMicrophoneSource, createProviderSession, type ProviderSocket } from "../voice/provider-session.js";

class FakeSocket implements ProviderSocket {
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  readyState = 1;
  failAtSend: number | undefined;

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    if (this.sent.length === this.failAtSend) throw new Error(`send failed at ${this.sent.length}`);
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
        queueMicrotask(() => socket.emit("message", { data: new Blob([JSON.stringify({ setupComplete: {} })]) }));
        return socket;
      },
    });
    const source = createMicrophoneSource();

    await session.open({ token: "auth_tokens/one-use", model: "gemini-live-test" });
    await session.enqueuePcm(new Int16Array([1, -2, 3]));
    session.startLiveContinuation(source);
    source.push(new Int16Array([4, -5]));
    expect(socket.sent).toHaveLength(3);
    socket.emit("message", {
      data: JSON.stringify({ toolCall: { functionCalls: [{ id: "admit-1", name: "admit_conversation" }] } }),
    });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(4));
    source.push(new Int16Array([4, -5]));

    const frames = socket.sent.map((frame) => JSON.parse(frame));
    expect(frames[0]).toMatchObject({
      setup: {
        model: "models/gemini-live-test",
        generationConfig: { responseModalities: ["AUDIO"] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [{ functionDeclarations: [{ name: "admit_conversation" }, { name: "stop_listening" }] }],
      },
    });
    expect(frames[0].setup).not.toHaveProperty("proactivity");
    expect(frames.slice(1)).toEqual([
      { realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: "AQD+/wMA" } } },
      { realtimeInput: { audioStreamEnd: true } },
      { toolResponse: { functionResponses: [{ id: "admit-1", name: "admit_conversation", response: { ok: true } }] } },
      { realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: "BAD7/w==" } } },
    ]);
  });

  it("routes provider audio after admission without another wake", async () => {
    const socket = new FakeSocket();
    const onAudio = vi.fn();
    const onModelSpeechStarted = vi.fn();
    const onModelSpeechFinished = vi.fn();
    const onAdmitted = vi.fn();
    const session = createProviderSession({
      onAudio,
      onModelSpeechStarted,
      onModelSpeechFinished,
      onAdmitted,
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: new Blob([JSON.stringify({ setupComplete: {} })]) }));
        return socket;
      },
    });

    await session.open({ token: "one-use", model: "gemini-live-test" });
    socket.emit("message", {
      data: JSON.stringify({ toolCall: { functionCalls: [{ id: "admit-1", name: "admit_conversation" }] } }),
    });
    socket.emit("message", {
      data: JSON.stringify({
        serverContent: {
          inputTranscription: { text: "what about tomorrow?" },
          modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AQIDBA==" } }] },
          turnComplete: true,
        },
      }),
    });
    await vi.waitFor(() => expect(onAdmitted).toHaveBeenCalledOnce());

    expect([...onAudio.mock.calls[0]![0]]).toEqual([1, 2, 3, 4]);
    expect(onModelSpeechStarted).toHaveBeenCalledOnce();
    expect(onModelSpeechFinished).toHaveBeenCalledOnce();

    session.sendSignals({
      delivery: "user-turn",
      signals: [{ id: "progress:one", priority: "low", detail: "one file remains" }],
    });
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      clientContent: {
        turns: [{ role: "user", parts: [{ text: expect.stringContaining("one file remains") }] }],
        turnComplete: false,
      },
    });
  });

  it("delivers settled input transcription for local dismissal matching", async () => {
    vi.useFakeTimers();
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
    socket.emit("message", { data: JSON.stringify({ serverContent: { inputTranscription: { text: "sto" } } }) });
    socket.emit("message", { data: JSON.stringify({ serverContent: { inputTranscription: { text: "stop." } } }) });
    await vi.advanceTimersByTimeAsync(350);

    expect(onInputTranscript).toHaveBeenCalledOnce();
    expect(onInputTranscript).toHaveBeenCalledWith("stop.");
    vi.useRealTimers();
  });

  it("holds early response audio until the admission control arrives", async () => {
    const socket = new FakeSocket();
    const onAudio = vi.fn();
    const onAdmitted = vi.fn();
    const session = createProviderSession({
      onAudio,
      onAdmitted,
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: new Blob([JSON.stringify({ setupComplete: {} })]) }));
        return socket;
      },
    });

    await session.open({ token: "one-use", model: "gemini-live-test" });
    socket.emit("message", { data: JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AQIDBA==" } }] } } }) });
    await Promise.resolve();
    expect(onAudio).not.toHaveBeenCalled();

    socket.emit("message", { data: JSON.stringify({ toolCall: { functionCalls: [{ id: "admit-1", name: "admit_conversation" }] } }) });
    await vi.waitFor(() => expect(onAdmitted).toHaveBeenCalledOnce());
    expect([...onAudio.mock.calls[0]![0]]).toEqual([1, 2, 3, 4]);
  });

  it("discards buffered response audio when the provider omits the admission control", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const onAudio = vi.fn();
      const onAdmitted = vi.fn();
      const onStopListening = vi.fn();
      const onTerminalDecision = vi.fn();
      const session = createProviderSession({
        admissionTimeoutMs: 250,
        onAudio,
        onAdmitted,
        onStopListening,
        onTerminalDecision,
        socketFactory: () => {
          queueMicrotask(() => socket.emit("open"));
          queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
          return socket;
        },
      });

      await session.open({ token: "one-use", model: "gemini-live-test" });
      await session.enqueuePcm(new Int16Array([1, 2]));
      socket.emit("message", { data: JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AQIDBA==" } }] } } }) });
      await vi.advanceTimersByTimeAsync(250);

      expect(onTerminalDecision).toHaveBeenCalledWith("timeout");
      expect(onStopListening).toHaveBeenCalledOnce();
      expect(onAdmitted).not.toHaveBeenCalled();
      expect(onAudio).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets an explicit rejection beat buffered audio without leaking it to playback", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const onAudio = vi.fn();
      const onAdmitted = vi.fn();
      const onStopListening = vi.fn();
      const onTerminalDecision = vi.fn();
      const session = createProviderSession({
        onAudio,
        onAdmitted,
        onStopListening,
        onTerminalDecision,
        socketFactory: () => {
          queueMicrotask(() => socket.emit("open"));
          queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
          return socket;
        },
      });

      await session.open({ token: "one-use", model: "gemini-live-test" });
      socket.emit("message", { data: JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AQIDBA==" } }] } } }) });
      socket.emit("message", { data: JSON.stringify({ toolCall: { functionCalls: [{ id: "stop-1", name: "stop_listening" }] } }) });
      await vi.advanceTimersByTimeAsync(250);

      expect(onTerminalDecision).toHaveBeenCalledWith("explicit-stop");
      expect(onStopListening).toHaveBeenCalledOnce();
      expect(onAdmitted).not.toHaveBeenCalled();
      expect(onAudio).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("suppresses pre-admission audio and closes silently when realtime rejects the opening", async () => {
    const socket = new FakeSocket();
    const onAudio = vi.fn();
    const onStopListening = vi.fn();
    const session = createProviderSession({
      onAudio,
      onStopListening,
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: new Blob([JSON.stringify({ setupComplete: {} })]) }));
        return socket;
      },
    });

    await session.open({ token: "one-use", model: "gemini-live-test" });
    socket.emit("message", { data: JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AQIDBA==" } }] } } }) });
    socket.emit("message", { data: JSON.stringify({ toolCall: { functionCalls: [{ id: "stop-1", name: "stop_listening" }] } }) });
    await vi.waitFor(() => expect(onStopListening).toHaveBeenCalledOnce());

    expect(onAudio).not.toHaveBeenCalled();
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      toolResponse: { functionResponses: [{ id: "stop-1", name: "stop_listening", response: { ok: true } }] },
    });
  });

  it("fails closed on malformed or conflicting admission controls", async () => {
    const socket = new FakeSocket();
    const onAdmitted = vi.fn();
    const onStopListening = vi.fn();
    const session = createProviderSession({
      onAdmitted,
      onStopListening,
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: new Blob([JSON.stringify({ setupComplete: {} })]) }));
        return socket;
      },
    });

    await session.open({ token: "one-use", model: "gemini-live-test" });
    socket.emit("message", {
      data: JSON.stringify({
        toolCall: {
          functionCalls: [
            { id: "admit-1", name: "admit_conversation" },
            { id: "stop-1", name: "stop_listening" },
          ],
        },
      }),
    });
    await vi.waitFor(() => expect(onStopListening).toHaveBeenCalledOnce());
    expect(onAdmitted).not.toHaveBeenCalled();
    expect(socket.sent).toHaveLength(1);
  });

  it("closes the owning conversation when the provider disappears after setup", async () => {
    const socket = new FakeSocket();
    const onClosed = vi.fn();
    const session = createProviderSession({
      onClosed,
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: new Blob([JSON.stringify({ setupComplete: {} })]) }));
        return socket;
      },
    });

    await session.open({ token: "one-use", model: "gemini-live-test" });
    socket.emit("close");
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it("fails closed when an admission control cannot be acknowledged", async () => {
    const socket = new FakeSocket();
    const onAdmitted = vi.fn();
    const onStopListening = vi.fn();
    const session = createProviderSession({
      onAdmitted,
      onStopListening,
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: new Blob([JSON.stringify({ setupComplete: {} })]) }));
        return socket;
      },
    });

    await session.open({ token: "one-use", model: "gemini-live-test" });
    socket.emit("message", {
      data: JSON.stringify({ toolCall: { functionCalls: [{ name: "admit_conversation" }] } }),
    });
    await vi.waitFor(() => expect(onStopListening).toHaveBeenCalledOnce());
    expect(onAdmitted).not.toHaveBeenCalled();
    expect(socket.sent).toHaveLength(1);
  });

  it("rejects a provisional session when realtime never returns a control", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const onStopListening = vi.fn();
    const session = createProviderSession({
      admissionTimeoutMs: 25,
      onStopListening,
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: new Blob([JSON.stringify({ setupComplete: {} })]) }));
        return socket;
      },
    });

    await session.open({ token: "one-use", model: "gemini-live-test" });
    await session.enqueuePcm(new Int16Array([1]));
    await vi.advanceTimersByTimeAsync(25);
    expect(onStopListening).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("recovers after setup timeout and opens a fresh ticket", async () => {
    vi.useFakeTimers();
    const first = new FakeSocket();
    const second = new FakeSocket();
    let calls = 0;
    const session = createProviderSession({
      setupTimeoutMs: 25,
      socketFactory: () => {
        const socket = calls++ === 0 ? first : second;
        if (socket === second) {
          queueMicrotask(() => socket.emit("open"));
          queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
        }
        return socket;
      },
    });

    const failed = expect(session.open({ token: "expired", model: "gemini-live-test" })).rejects.toThrow(/did not complete setup/);
    await vi.advanceTimersByTimeAsync(25);
    await failed;
    expect(first.readyState).toBe(3);
    await session.open({ token: "fresh", model: "gemini-live-test" });
    vi.useRealTimers();
  });

  it("recovers after the socket closes during setup", async () => {
    const first = new FakeSocket();
    const second = new FakeSocket();
    let calls = 0;
    const session = createProviderSession({
      socketFactory: () => {
        const socket = calls++ === 0 ? first : second;
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", socket === first
          ? { data: JSON.stringify({ unrelated: true }) }
          : { data: JSON.stringify({ setupComplete: {} }) }));
        if (socket === first) queueMicrotask(() => socket.emit("close", { code: 1006 }));
        return socket;
      },
    });

    await expect(session.open({ token: "broken", model: "gemini-live-test" })).rejects.toThrow(/closed before setup/);
    await session.open({ token: "fresh", model: "gemini-live-test" });
  });

  it("recovers after a provisional provider failure", async () => {
    const first = new FakeSocket();
    const second = new FakeSocket();
    const sockets = [first, second];
    const onClosed = vi.fn();
    const session = createProviderSession({
      onClosed,
      socketFactory: () => {
        const socket = sockets.shift()!;
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
        return socket;
      },
    });

    await session.open({ token: "first", model: "gemini-live-test" });
    await session.enqueuePcm(new Int16Array([1]));
    first.emit("close");
    expect(onClosed).toHaveBeenCalledOnce();
    await session.open({ token: "second", model: "gemini-live-test" });
  });

  it("recovers after an admitted provider failure", async () => {
    const first = new FakeSocket();
    const second = new FakeSocket();
    const sockets = [first, second];
    const onClosed = vi.fn();
    const session = createProviderSession({
      onClosed,
      socketFactory: () => {
        const socket = sockets.shift()!;
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
        return socket;
      },
    });

    await session.open({ token: "first", model: "gemini-live-test" });
    first.emit("message", { data: JSON.stringify({ toolCall: { functionCalls: [{ id: "admit-1", name: "admit_conversation" }] } }) });
    await vi.waitFor(() => expect(first.sent).toHaveLength(2));
    first.emit("error");
    expect(onClosed).toHaveBeenCalledOnce();
    await session.open({ token: "second", model: "gemini-live-test" });
  });

  it("emits one admission terminal outcome when the provider later fails", async () => {
    const socket = new FakeSocket();
    const onTerminalDecision = vi.fn();
    const onClosed = vi.fn();
    const session = createProviderSession({
      onTerminalDecision,
      onClosed,
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
        return socket;
      },
    });

    await session.open({ token: "one-use", model: "gemini-live-test" });
    socket.emit("message", { data: JSON.stringify({ toolCall: { functionCalls: [{ id: "admit-1", name: "admit_conversation" }] } }) });
    await vi.waitFor(() => expect(onTerminalDecision).toHaveBeenCalledWith("explicit-admit"));
    socket.emit("error");

    expect(onTerminalDecision).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it("fails closed when the admission acknowledgement cannot be sent", async () => {
    const socket = new FakeSocket();
    const onAdmitted = vi.fn();
    const onAudio = vi.fn();
    const onClosed = vi.fn();
    const onTerminalDecision = vi.fn();
    const session = createProviderSession({
      onAdmitted,
      onAudio,
      onClosed,
      onTerminalDecision,
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
        return socket;
      },
    });

    await session.open({ token: "one-use", model: "gemini-live-test" });
    socket.emit("message", { data: JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AQIDBA==" } }] } } }) });
    await Promise.resolve();
    socket.failAtSend = socket.sent.length;
    socket.emit("message", { data: JSON.stringify({ toolCall: { functionCalls: [{ id: "admit-1", name: "admit_conversation" }] } }) });
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledOnce());

    expect(onTerminalDecision).toHaveBeenCalledWith("provider-failure");
    expect(onAdmitted).not.toHaveBeenCalled();
    expect(onAudio).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3])("makes opening send failure at frame %i terminal and non-retryable", async (failAtSend) => {
    const socket = new FakeSocket();
    const onClosed = vi.fn();
    const onTerminalDecision = vi.fn();
    const session = createProviderSession({
      onClosed,
      onTerminalDecision,
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
        return socket;
      },
    });

    await session.open({ token: "one-use", model: "gemini-live-test" });
    socket.failAtSend = failAtSend;
    await expect(session.enqueuePcm(new Int16Array(321))).rejects.toThrow(/send failed/);
    expect(onTerminalDecision).toHaveBeenCalledWith("provider-failure");
    expect(onClosed).toHaveBeenCalledOnce();
    await expect(session.enqueuePcm(new Int16Array([1]))).rejects.toThrow(/not open/);
  });

  it("rejects oversized encoded provisional audio before decoding or playback", async () => {
    const socket = new FakeSocket();
    const onAudio = vi.fn();
    const onStopListening = vi.fn();
    const onTerminalDecision = vi.fn();
    const session = createProviderSession({
      onAudio,
      onStopListening,
      onTerminalDecision,
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
        return socket;
      },
    });

    await session.open({ token: "one-use", model: "gemini-live-test" });
    socket.emit("message", { data: JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "A".repeat(90_000) } }] } } }) });
    await vi.waitFor(() => expect(onStopListening).toHaveBeenCalledOnce());
    expect(onTerminalDecision).toHaveBeenCalledWith("invalid-output");
    expect(onAudio).not.toHaveBeenCalled();
  });

  it("rejects noncanonical base64 and never lets a same-frame admit bypass output validation", async () => {
    const socket = new FakeSocket();
    const onAdmitted = vi.fn();
    const onAudio = vi.fn();
    const onStopListening = vi.fn();
    const onTerminalDecision = vi.fn();
    const session = createProviderSession({
      onAdmitted,
      onAudio,
      onStopListening,
      onTerminalDecision,
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
        return socket;
      },
    });

    await session.open({ token: "one-use", model: "gemini-live-test" });
    socket.emit("message", {
      data: JSON.stringify({
        toolCall: { functionCalls: [{ id: "admit-1", name: "admit_conversation" }] },
        serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AB==" } }] } },
      }),
    });
    await vi.waitFor(() => expect(onStopListening).toHaveBeenCalledOnce());

    expect(onTerminalDecision).toHaveBeenCalledWith("invalid-output");
    expect(onAdmitted).not.toHaveBeenCalled();
    expect(onAudio).not.toHaveBeenCalled();
  });

  it("accepts Gemini's measured small-chunk framing below the aggregate byte limit", async () => {
    const socket = new FakeSocket();
    const onAudio = vi.fn();
    const session = createProviderSession({
      onAudio,
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
        return socket;
      },
    });

    await session.open({ token: "one-use", model: "gemini-live-test" });
    for (let index = 0; index < 101; index += 1) {
      socket.emit("message", { data: JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AQIDBA==" } }] } } }) });
    }
    await vi.waitFor(() => expect(socket.readyState).toBe(1));
    expect(onAudio).not.toHaveBeenCalled();
    socket.emit("message", { data: JSON.stringify({ toolCall: { functionCalls: [{ id: "admit-1", name: "admit_conversation" }] } }) });
    await vi.waitFor(() => expect(onAudio).toHaveBeenCalledTimes(101));
  });

  it("drops one trailing provider byte before releasing PCM after explicit admission", async () => {
    const socket = new FakeSocket();
    const onAudio = vi.fn();
    const session = createProviderSession({
      onAudio,
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
        return socket;
      },
    });

    await session.open({ token: "one-use", model: "gemini-live-test" });
    socket.emit("message", { data: JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AQID" } }] } } }) });
    await Promise.resolve();
    expect(onAudio).not.toHaveBeenCalled();
    socket.emit("message", { data: JSON.stringify({ toolCall: { functionCalls: [{ id: "admit-1", name: "admit_conversation" }] } }) });
    await vi.waitFor(() => expect(onAudio).toHaveBeenCalledOnce());

    expect([...onAudio.mock.calls[0]![0]]).toEqual([1, 2]);
  });

  it("delivers an admitted stop exactly once and ignores duplicate stop controls", async () => {
    const socket = new FakeSocket();
    const onStopListening = vi.fn();
    const onTerminalDecision = vi.fn();
    const session = createProviderSession({
      onStopListening,
      onTerminalDecision,
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
        return socket;
      },
    });

    await session.open({ token: "one-use", model: "gemini-live-test" });
    socket.emit("message", { data: JSON.stringify({ toolCall: { functionCalls: [{ id: "admit-1", name: "admit_conversation" }] } }) });
    await vi.waitFor(() => expect(onTerminalDecision).toHaveBeenCalledWith("explicit-admit"));
    socket.emit("message", { data: JSON.stringify({ toolCall: { functionCalls: [{ id: "stop-1", name: "stop_listening" }] } }) });
    socket.emit("message", { data: JSON.stringify({ toolCall: { functionCalls: [{ id: "stop-2", name: "stop_listening" }] } }) });
    await vi.waitFor(() => expect(onStopListening).toHaveBeenCalledOnce());

    expect(onTerminalDecision).toHaveBeenCalledTimes(1);
  });

  it("closes and permits a fresh open after continuation send failure", async () => {
    const first = new FakeSocket();
    const second = new FakeSocket();
    const sockets = [first, second];
    const onClosed = vi.fn();
    const session = createProviderSession({
      onClosed,
      socketFactory: () => {
        const socket = sockets.shift()!;
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
        return socket;
      },
    });
    const source = createMicrophoneSource();

    await session.open({ token: "first", model: "gemini-live-test" });
    await session.enqueuePcm(new Int16Array([1]));
    session.startLiveContinuation(source);
    first.emit("message", { data: JSON.stringify({ toolCall: { functionCalls: [{ id: "admit-1", name: "admit_conversation" }] } }) });
    await vi.waitFor(() => expect(first.sent).toHaveLength(4));
    first.failAtSend = first.sent.length;
    source.push(new Int16Array([2]));

    expect(onClosed).toHaveBeenCalledOnce();
    await session.open({ token: "second", model: "gemini-live-test" });
  });

  it("serializes an earlier slow Blob ahead of the admission timeout", async () => {
    vi.useFakeTimers();
    let resolveText!: (value: string) => void;
    class DeferredBlob extends Blob {
      override text(): Promise<string> {
        return new Promise((resolve) => {
          resolveText = resolve;
        });
      }
    }
    const socket = new FakeSocket();
    const onAdmitted = vi.fn();
    const onStopListening = vi.fn();
    const onTerminalDecision = vi.fn();
    const session = createProviderSession({
      admissionTimeoutMs: 25,
      onAdmitted,
      onStopListening,
      onTerminalDecision,
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
        return socket;
      },
    });

    await session.open({ token: "one-use", model: "gemini-live-test" });
    await session.enqueuePcm(new Int16Array([1]));
    socket.emit("message", {
      data: new DeferredBlob([JSON.stringify({ toolCall: { functionCalls: [{ id: "admit-1", name: "admit_conversation" }] } })]),
    });
    await vi.advanceTimersByTimeAsync(25);
    resolveText(JSON.stringify({ toolCall: { functionCalls: [{ id: "admit-1", name: "admit_conversation" }] } }));
    await vi.runAllTimersAsync();

    expect(onAdmitted).toHaveBeenCalledOnce();
    expect(onStopListening).not.toHaveBeenCalled();
    expect(onTerminalDecision).toHaveBeenCalledWith("explicit-admit");
    vi.useRealTimers();
  });

  it("does not carry same-frame stop audio into a fresh session", async () => {
    const first = new FakeSocket();
    const second = new FakeSocket();
    const sockets = [first, second];
    const onAudio = vi.fn();
    let session!: ReturnType<typeof createProviderSession>;
    session = createProviderSession({
      onAudio,
      onStopListening: () => session.close(),
      socketFactory: () => {
        const socket = sockets.shift()!;
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
        return socket;
      },
    });

    await session.open({ token: "first", model: "gemini-live-test" });
    first.emit("message", {
      data: JSON.stringify({
        toolCall: { functionCalls: [{ id: "stop-1", name: "stop_listening" }] },
        serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AQIDBA==" } }] } },
      }),
    });
    await vi.waitFor(() => expect(first.readyState).toBe(3));

    await session.open({ token: "second", model: "gemini-live-test" });
    second.emit("message", { data: JSON.stringify({ toolCall: { functionCalls: [{ id: "admit-2", name: "admit_conversation" }] } }) });
    await Promise.resolve();
    expect(onAudio).not.toHaveBeenCalled();
  });

  it("cleans up signal send failure and opens a fresh provider session", async () => {
    const first = new FakeSocket();
    const second = new FakeSocket();
    const sockets = [first, second];
    const onClosed = vi.fn();
    const session = createProviderSession({
      onClosed,
      socketFactory: () => {
        const socket = sockets.shift()!;
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ setupComplete: {} }) }));
        return socket;
      },
    });

    await session.open({ token: "first", model: "gemini-live-test" });
    first.emit("message", { data: JSON.stringify({ toolCall: { functionCalls: [{ id: "admit-1", name: "admit_conversation" }] } }) });
    await vi.waitFor(() => expect(first.sent).toHaveLength(2));
    first.failAtSend = first.sent.length;
    expect(() => session.sendSignals({ delivery: "automatic", signals: [{ id: "answer:one", priority: "urgent", detail: "done" }] })).not.toThrow();

    expect(onClosed).toHaveBeenCalledOnce();
    await session.open({ token: "second", model: "gemini-live-test" });
  });

  it("refuses early continuation and duplicate opening handoffs", async () => {
    const socket = new FakeSocket();
    const session = createProviderSession({
      socketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        queueMicrotask(() => socket.emit("message", { data: new Blob([JSON.stringify({ setupComplete: {} })]) }));
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

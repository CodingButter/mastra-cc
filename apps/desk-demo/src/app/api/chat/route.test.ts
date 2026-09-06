import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoEvent } from "../../../lib/events";

// The turn is read chunk by chunk rather than as a text stream, because the
// failure this route has to survive - the model provider's rate limit - arrives
// as an error CHUNK in the middle of a stream that has already run tool calls,
// and a text stream drops it silently (rate-limit.ts).
function streamOf(chunks: unknown[]): ReadableStream {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

const text = (value: string) => ({ type: "text-delta", payload: { text: value } });
const rateLimited = {
  type: "error",
  payload: {
    error: { statusCode: 429, message: 'quota exceeded ... "retryDelay": "0.01s"' },
  },
};

// MEASURED 2026-09-05: the provider never sent response headers and the errand
// stopped at step 41 with the desk half-driven. The undici error carries no 429
// and no quota words - only a retryable flag and a timeout message.
const headersTimeout = {
  type: "error",
  payload: {
    // The flag is the only witness here on purpose: the provider's wording for
    // a transient fault changes, and a turn that resumed only on words it
    // recognised would end the next errand at the next new sentence.
    error: { isRetryable: true, message: "Cannot connect to API" },
  },
};

const refused = {
  type: "error",
  payload: { error: { statusCode: 401, message: "API key not valid" } },
};

let interruption: unknown = rateLimited;
const turns: unknown[][] = [];
let terminal = false;
let attempted = false;
let chunks: unknown[] = [];
let observedSignal: AbortSignal | undefined;

beforeEach(() => {
  attempted = false;
  chunks = [];
  observedSignal = undefined;
});
afterEach(() => vi.useRealTimers());

vi.mock("../../../lib/agent", () => ({
  deskAgent: (emit: (event: DemoEvent) => void, onTerminal: (error: Error) => void, signal: AbortSignal) => ({
    stream: async (history: unknown[], options: { abortSignal: AbortSignal }) => {
      observedSignal = signal;
      expect(signal).toBe(options.abortSignal);
      turns.push([...history]);
      if (attempted) emit({ type: "tool", callId: "dispatched", name: "typeText", params: { text: "sent" } });
      if (terminal) {
        const error = new Error("transport: connection closed");
        onTerminal(error);
        expect(options.abortSignal.aborted).toBe(true);
        return { fullStream: streamOf([]) };
      }
      return {
        fullStream: streamOf(turns.length === 1 ? [text("half an errand"), ...chunks, interruption] : [text(" and the rest")]),
      };
    },
  }),
}));

import { POST } from "./route";

async function post(content: string): Promise<string> {
  const response = await POST(
    new Request("http://desk.test/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content }] }),
    }),
  );
  return await response.text();
}

describe("POST", () => {
  it.each([false, true])("does not replay a failed turn after tool dispatch (wrapper=%s)", async (wrapper) => {
    terminal = false;
    turns.length = 0;
    interruption = rateLimited;
    attempted = wrapper;
    if (!wrapper) chunks = [{ type: "tool-call", payload: { toolCallId: "one", toolName: "typeText", args: { text: "sent" } } }];
    const body = await post("type once");
    expect(body).toContain("automatic retry stopped");
    expect(body).not.toContain('"type":"done"');
    expect(turns).toHaveLength(1);
    expect(observedSignal?.aborted).toBe(true);
  });

  it.each(["request", "response"])("cancels %s during retry sleep without starting another run", async (which) => {
    vi.useFakeTimers();
    terminal = false;
    turns.length = 0;
    interruption = rateLimited;
    const abort = new AbortController();
    const response = await POST(new Request("http://desk.test/api/chat", {
      method: "POST", signal: abort.signal,
      body: JSON.stringify({ messages: [{ role: "user", content: "read" }] }),
    }));
    const reader = response.body!.getReader();
    await reader.read();
    if (which === "request") abort.abort();
    else await reader.cancel();
    expect(observedSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(turns).toHaveLength(1);
    expect(await reader.read()).toMatchObject({ done: true });
  });

  it("emits one error and closes after a terminal desktop failure", async () => {
    terminal = true;
    turns.length = 0;

    expect(await post("read the desk")).toBe(
      '{"type":"error","message":"transport: connection closed"}\n',
    );
  });

  it("waits out a rate limit and carries the same errand on, rather than ending the turn", async () => {
    // The measured failure: a 429 mid-stream ended the turn with no final
    // message, which reads exactly like an agent that gave up on the errand.
    terminal = false;
    turns.length = 0;
    interruption = rateLimited;

    const body = await post("set the wallpaper");

    expect(body).toContain('"text":"half an errand"');
    expect(body).toContain('"text":" and the rest"');
    expect(body).toContain('{"type":"done"}');
    expect(body).not.toContain('"type":"error"');
    expect(turns).toHaveLength(2);
  });

  it("resumes with its prose but does not assume the desk stayed unchanged", async () => {
    terminal = false;
    turns.length = 0;
    interruption = rateLimited;

    await post("set the wallpaper");

    const resumed = turns[1] as { role: string; content: string }[];
    expect(resumed[0]).toEqual({ role: "user", content: "set the wallpaper" });
    expect(resumed[1]).toEqual({ role: "assistant", content: "half an errand" });
    expect(resumed[2]!.role).toBe("user");
    expect(resumed[2]!.content).toContain("not guaranteed to be exactly as you left it");
    expect(resumed[2]!.content).toContain("before any tool was attempted");
  });

  it("carries on through a provider connection that timed out, which touched no desk", async () => {
    terminal = false;
    turns.length = 0;
    interruption = headersTimeout;

    const body = await post("set the wallpaper");

    expect(body).toContain('"text":" and the rest"');
    expect(body).toContain('{"type":"done"}');
    expect(body).not.toContain('"type":"error"');
    expect(turns).toHaveLength(2);
  });

  it("ends the turn loudly at a fault that waiting cannot mend", async () => {
    terminal = false;
    turns.length = 0;
    interruption = refused;

    const body = await post("set the wallpaper");

    expect(body).toContain('"type":"error"');
    expect(body).toContain("API key not valid");
    expect(turns).toHaveLength(1);
  });
});

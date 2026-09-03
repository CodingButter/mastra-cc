import { describe, expect, it } from "vitest";
import { consumeDemoStream } from "../stream";

function response(chunks: string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    init,
  );
}

describe("consumeDemoStream", () => {
  it("parses split lines and a final event without a newline", async () => {
    const events: unknown[] = [];
    const result = await consumeDemoStream(
      response(['{"type":"text","te', 'xt":"hi"}\n{"type":"done"}']),
      (event) => events.push(event),
    );
    expect(events).toEqual([{ type: "text", text: "hi" }, { type: "done" }]);
    expect(result.serverErrorSeen).toBe(false);
  });

  it("reports a server error event", async () => {
    const result = await consumeDemoStream(
      response(['{"type":"error","message":"desk closed"}\n']),
      () => {},
    );
    expect(result.serverErrorSeen).toBe(true);
  });

  it("rejects non-OK, absent-body, and malformed responses", async () => {
    await expect(consumeDemoStream(response([], { status: 503 }), () => {})).rejects.toThrow("503");
    await expect(consumeDemoStream(new Response(null), () => {})).rejects.toThrow("no body");
    await expect(consumeDemoStream(response(['{"type":']), () => {})).rejects.toThrow();
  });

  it("surfaces reader failures", async () => {
    const failed = new Response(
      new ReadableStream({
        pull(controller) {
          controller.error(new Error("reader broke"));
        },
      }),
    );
    await expect(consumeDemoStream(failed, () => {})).rejects.toThrow("reader broke");
  });
});

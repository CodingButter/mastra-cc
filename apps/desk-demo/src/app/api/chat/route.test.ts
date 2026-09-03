import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/agent", () => ({
  deskAgent: (_emit: unknown, onTerminal: (error: Error) => void) => ({
    stream: async (_history: unknown, options: { abortSignal: AbortSignal }) => {
      const error = new Error("transport: connection closed");
      onTerminal(error);
      expect(options.abortSignal.aborted).toBe(true);
      return {
        textStream: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
      };
    },
  }),
}));

import { POST } from "./route";

describe("POST", () => {
  it("emits one error and closes after a terminal desktop failure", async () => {
    const response = await POST(
      new Request("http://desk.test/api/chat", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "read the desk" }] }),
      }),
    );

    expect(await response.text()).toBe(
      '{"type":"error","message":"transport: connection closed"}\n',
    );
  });
});

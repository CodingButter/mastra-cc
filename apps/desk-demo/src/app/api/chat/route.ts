import { deskAgent } from "../../../lib/agent";
import type { DemoEvent } from "../../../lib/events";

export const runtime = "nodejs";
// The turn is as long as the errand, and a handover waits on a human being.
export const maxDuration = 3600;

type Incoming = { messages?: { role: "user" | "assistant"; content: string }[] };

export async function POST(request: Request) {
  const body = (await request.json()) as Incoming;
  const messages = body.messages ?? [];
  if (messages.length === 0) return new Response("no messages", { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: DemoEvent) => {
        if (!open) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const turnAbort = new AbortController();
      let terminalError: Error | undefined;
      try {
        const agent = deskAgent(send, (error) => {
          terminalError = error;
          turnAbort.abort(error);
        });
        // Narrowed one at a time so each element is a discriminated model
        // message rather than a union-typed bag the framework cannot place.
        const history = messages.map((m) =>
          m.role === "user"
            ? ({ role: "user", content: m.content } as const)
            : ({ role: "assistant", content: m.content } as const),
        );
        const run = await agent.stream(history, { maxSteps: 40, abortSignal: turnAbort.signal });
        for await (const delta of run.textStream) send({ type: "text", text: delta });
        if (terminalError) throw terminalError;
        send({ type: "done" });
      } catch (error) {
        const failure = terminalError ?? error;
        send({ type: "error", message: failure instanceof Error ? failure.message : String(failure) });
      } finally {
        open = false;
        controller.close();
      }
    },
  });

  // Newline-delimited JSON rather than an agent-framework stream format: this
  // demo streams five kinds of event and the browser renders all five, so the
  // shape is worth being able to read in a terminal.
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

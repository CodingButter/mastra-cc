import { deskAgent } from "../../../lib/agent";
import type { DemoEvent } from "../../../lib/events";
import { isResumable, retryDelayMs, sleep } from "../../../lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 3600;

type Message = { role: "user"; content: string } | { role: "assistant"; content: string };
type Incoming = { messages?: Message[] };
const RESUMES = 5;
const RESUMED = [
  "You were interrupted by the model provider before any tool was attempted.",
  "No desktop operation was attempted by this turn. The desk is not guaranteed to be exactly as you left it.",
  "Read the desk again rather than assuming, then carry on with the same errand.",
].join(" ");

export async function POST(request: Request) {
  const body = (await request.json()) as Incoming;
  const messages = body.messages ?? [];
  if (messages.length === 0) return new Response("no messages", { status: 400 });

  const encoder = new TextEncoder();
  const turnAbort = new AbortController();
  let open = true;
  let closeResponse: (() => void) | undefined;
  const disconnect = () => {
    turnAbort.abort(request.signal.reason);
    closeResponse?.();
  };
  request.signal.addEventListener("abort", disconnect, { once: true });
  if (request.signal.aborted) disconnect();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      closeResponse = () => {
        if (!open) return;
        open = false;
        controller.close();
      };
      let toolAttempted = false;
      const send = (event: DemoEvent) => {
        // The wrapper announces dispatch before calling the tool. This also
        // catches attempts whose tool-call chunk never reaches fullStream.
        if (event.type === "tool" || (event.type === "control" && event.mode === "interact")) toolAttempted = true;
        if (!open || request.signal.aborted) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      let terminalError: Error | undefined;
      try {
        turnAbort.signal.throwIfAborted();
        const agent = deskAgent(send, (error) => {
          terminalError = error;
          turnAbort.abort(error);
        }, turnAbort.signal);
        const history: Message[] = [...messages];
        for (let attempt = 0; ; attempt++) {
          turnAbort.signal.throwIfAborted();
          const run = await agent.stream(history, { maxSteps: 400, abortSignal: turnAbort.signal });
          let said = "";
          let limited: unknown;
          for await (const chunk of run.fullStream) {
            turnAbort.signal.throwIfAborted();
            if (chunk.type === "text-delta") {
              const text = String((chunk.payload as { text?: unknown }).text ?? "");
              if (text.length > 0) {
                said += text;
                send({ type: "text", text });
              }
            } else if (chunk.type === "tool-call") {
              toolAttempted = true;
            } else if (chunk.type === "error") {
              limited = (chunk.payload as { error?: unknown }).error ?? chunk.payload;
            }
          }
          if (terminalError) throw terminalError;
          turnAbort.signal.throwIfAborted();
          if (limited === undefined) break;
          if (!isResumable(limited) || attempt >= RESUMES) throw asError(limited);
          // A failed stream does not prove its tools have settled, nor that
          // response.messages contains every partial call/result pair. Until
          // both are established, never replace structured history with prose
          // and silently replay a turn that may have changed the real desk.
          if (toolAttempted) throw new Error("The provider interrupted a turn after a tool was attempted. Desktop effects may already have happened; automatic retry stopped. Read the desk before continuing.");
          if (said.length > 0) history.push({ role: "assistant", content: said });
          history.push({ role: "user", content: RESUMED });
          await sleep(retryDelayMs(limited), turnAbort.signal);
        }
        send({ type: "done" });
      } catch (error) {
        const failure = terminalError ?? error;
        turnAbort.abort(failure);
        send({ type: "error", message: failure instanceof Error ? failure.message : String(failure) });
      } finally {
        turnAbort.abort();
        request.signal.removeEventListener("abort", disconnect);
        closeResponse();
      }
    },
    cancel(reason) {
      // The response is already closed by the stream machinery here.
      open = false;
      turnAbort.abort(reason);
      request.signal.removeEventListener("abort", disconnect);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function asError(thrown: unknown): Error {
  if (thrown instanceof Error) return thrown;
  const bag = thrown as { message?: unknown };
  return new Error(typeof bag?.message === "string" ? bag.message : String(thrown));
}

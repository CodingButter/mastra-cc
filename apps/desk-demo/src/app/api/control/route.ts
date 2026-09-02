import { controlState, release, watchControl } from "../../../lib/control";

export const runtime = "nodejs";
export const maxDuration = 3600;

/**
 * Who holds the desk, streamed.
 *
 * The browser does not decide this and does not remember it: the overlay follows
 * this stream, so the lock cannot drift from what the agent's tool is waiting on.
 */
export function GET() {
  const encoder = new TextEncoder();
  let stop: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      stop = watchControl((state) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(state)}\n\n`));
      });
    },
    cancel() {
      stop?.();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}

/** The person pressed Done. */
export async function POST(request: Request) {
  const { requestId } = (await request.json()) as { requestId?: string };
  const released = requestId ? release(requestId) : false;
  return Response.json({ released, state: controlState() });
}

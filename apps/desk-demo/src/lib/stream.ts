import type { DemoEvent } from "./events";

export async function consumeDemoStream(
  response: Response,
  apply: (event: DemoEvent) => void,
): Promise<{ serverErrorSeen: boolean }> {
  if (!response.ok) throw new Error(`chat request failed (${response.status})`);
  if (!response.body) throw new Error("chat response had no body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let serverErrorSeen = false;
  let completed = false;

  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as DemoEvent;
    if (event.type === "error") serverErrorSeen = true;
    if (event.type === "done") completed = true;
    apply(event);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) consume(line);
    }

    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
  } catch (cause) {
    if (completed || serverErrorSeen) throw cause;
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${detail}. Desktop effects may already have happened; read the desk before continuing.`, { cause });
  } finally {
    reader.releaseLock();
  }
  if (!completed && !serverErrorSeen) {
    throw new Error("The response ended before the turn completed. Desktop effects may already have happened; read the desk before continuing.");
  }
  return { serverErrorSeen };
}

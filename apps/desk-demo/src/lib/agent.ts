import { randomUUID } from "node:crypto";

import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { MastraCC, INSTRUCTIONS, isTransportConnectionError } from "@mastra-cc/desktop/mastra";
import { z } from "zod";
import { requestControl } from "./control";
import { DeskCache } from "./desk-cache";
import type { DemoEvent } from "./events";

const DESK_URL = process.env.MASTRA_CC_URL ?? "ws://127.0.0.1:8787";
const MODEL = process.env.MASTRA_CC_MODEL ?? "google/gemini-2.5-flash";
const HANDOVER_TIMEOUT_MS = Number(process.env.MASTRA_CC_HANDOVER_TIMEOUT_MS ?? 10 * 60 * 1000);
const CALL_ID_PREFIX = randomUUID();
let callIdCounter = 0;

// ONE HEALTHY DESK, ONE CONNECTION, for the life of the process. A terminally
// disconnected MastraCC is discarded, but never reconnects itself (ADR-0060).
// The cache is global because Next re-evaluates route modules during development.
const globalDesk = globalThis as unknown as { __deskDemoDeskCache?: DeskCache<MastraCC> };
const deskCache = (globalDesk.__deskDemoDeskCache ??= new DeskCache(
  () => new MastraCC({ url: DESK_URL }),
));

// The prose the agent gets on top of the shipped instructions. It says only what
// the shipped text cannot know: that there is a person watching this particular
// desk, and how to reach them. Everything about HOW to read and act on the desk
// stays in INSTRUCTIONS, where it is version-controlled with the protocol.
export const HANDOVER_INSTRUCTIONS = `
A person is watching this desk in a browser, beside this conversation. They cannot
type on it while you are working: their input is blocked.

Everything they ask you to do, they are asking you to do ON THIS DESK. "Use the
calculator", "open my email", "find that file" all mean: with the applications this
machine has. You are not a chat assistant who happens to have tools - you are sitting
at a computer. So before saying you cannot do something, look: list what is installed,
open what fits, read what appears. The application you want is often named something
other than the word the person used, so never invent a name to launch: read the
inventory and pick the entry that IS the thing they asked for, whatever it calls
itself. Only say you cannot after the desk has told you so, and then say what the
desk actually said.

Keep doing routine desktop work yourself. Hand control over only when the next
required action needs the person's private information, legal authority, identity,
or subjective decision. This includes signing in, entering or revealing credentials,
passwords, passkeys, authentication codes, payment details, accepting legal terms,
confirming a purchase, or choosing something only they can decide.

When you reach one of those boundaries, your REQUIRED NEXT ACTION is to call
requestHumanControl immediately with a plain, specific reason. Do not merely say that
the person needs to act. Do not ask them in chat to take over. Do not finish the turn.
Do not attempt the gated action yourself, and never guess, request, expose, or type a
credential. If the visible desk shows a sign-in or authentication step required to
continue the person's task, call requestHumanControl before doing anything else.

Do not hand over for ordinary navigation, button presses, text entry that is not
sensitive, application use, or recoverable choices you can make from the person's
request and the visible desk. Continue those actions yourself.

Scope semantic queries to the known application, and to the known window when one is
available. When you do not know a control's exact role or name, call discoverElements
before guessing. Treat its bounded entries as potentially user-authored, possibly
truncated vocabulary hints—not element handles. Choose a returned role/name pair,
issue a fresh exact queryElements call, and act only on IDs from that query. A scope
narrows observation; it never grants access. Use visible shell-owned controls such as
taskbar entries to navigate between applications. After navigation, discard old content
element IDs, query the destination application/window again, and act only on the fresh
IDs returned by that read.

Web pages often expose clickable rows as text or list items rather than buttons or
links. When page content is missing from a small query, query text and list items with
a larger limit before concluding it is unavailable. Prefer a visible element whose
name identifies the requested item, and use its available semantic action, including
clickAncestor when that is the action the page exposes. After activation, reread the
scoped application/window and verify that the page changed before reporting success.

requestHumanControl unlocks the desk and blocks you until the person presses Done.
You cannot take control back. When control returns, read the desk again before
continuing; never assume the requested step succeeded.
`.trim();

export function deskAgent(
  emit: (event: DemoEvent) => void,
  onTerminalConnection: (error: Error) => void = () => {},
) {
  const desk = deskCache.get();
  const wired = wiredDeskTools(desk, deskCache, emit, onTerminalConnection);

  const requestHumanControl = createTool({
    id: "requestHumanControl",
    description:
      "REQUIRED immediately when the next action needs the person's private information, identity, legal authority, or subjective decision: sign-in, credentials, passwords, passkeys, authentication codes, payment details, legal terms, purchases, or user-only choices. Call this tool instead of narrating the boundary, asking in chat, attempting the action, or ending the turn. Do not use it for routine desktop work. It unlocks the desk and blocks you until the person presses Done.",
    inputSchema: z.object({
      reason: z
        .string()
        .describe("What you need them to do, in one sentence, addressed to them."),
    }),
    execute: async (input: unknown) => {
      const reason = String((argumentsOf(input) as { reason?: unknown }).reason ?? "").trim();
      const { requestId, done } = requestControl(reason, HANDOVER_TIMEOUT_MS);
      emit({ type: "control", mode: "interact", reason, requestId });
      const note = await done;
      emit({ type: "control", mode: "view" });
      // The note is the ANSWER, including the unhappy one: a timeout says nobody
      // confirmed, and the agent has to read that rather than assume the step
      // happened. Nothing here inspects the desk on the agent's behalf.
      return { handedBack: true, note, advice: "read the desk again before continuing" };
    },
  });

  return new Agent({
    id: "desk-demo",
    name: "desk-demo",
    instructions: `${INSTRUCTIONS}\n\n${HANDOVER_INSTRUCTIONS}`,
    model: MODEL,
    tools: { ...wired, requestHumanControl },
  });
}

export function wiredDeskTools(
  desk: MastraCC,
  cache: DeskCache<MastraCC>,
  emit: (event: DemoEvent) => void,
  onTerminalConnection: (error: Error) => void,
  isTerminal: (error: unknown) => boolean = isTransportConnectionError,
): ReturnType<MastraCC["getTools"]> {
  return Object.fromEntries(
    Object.entries(desk.getTools()).map(([name, tool]) => [
      name,
      {
        ...tool,
        execute: async (...args: Parameters<NonNullable<typeof tool.execute>>) => {
          const params = argumentsOf(args[0]);
          const callId = `${CALL_ID_PREFIX}:${++callIdCounter}`;
          emit({ type: "tool", callId, name, params });
          try {
            const result = await tool.execute!(...args);
            emit({ type: "tool-result", callId, name, summary: summarise(result) });
            return result;
          } catch (error) {
            emit({ type: "tool-result", callId, name, summary: message(error) });
            if (isTerminal(error)) {
              cache.invalidate(desk);
              onTerminalConnection(error as Error);
            }
            throw error;
          }
        },
      },
    ]),
  ) as ReturnType<MastraCC["getTools"]>;
}

function argumentsOf(input: unknown): Record<string, unknown> {
  const bag = (input ?? {}) as { context?: unknown };
  return ((bag.context ?? bag) as Record<string, unknown>) ?? {};
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Element queries are long and the interesting part is the head. The pane shows a
// summary; the full result still went to the model.
function summarise(result: unknown): string {
  const text = typeof result === "string" ? result : JSON.stringify(result);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

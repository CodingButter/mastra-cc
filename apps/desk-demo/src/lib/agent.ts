import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { MastraCC, INSTRUCTIONS } from "@mastra-cc/desktop/mastra";
import { z } from "zod";
import { requestControl } from "./control";
import type { DemoEvent } from "./events";

const DESK_URL = process.env.MASTRA_CC_URL ?? "ws://127.0.0.1:8787";
const MODEL = process.env.MASTRA_CC_MODEL ?? "google/gemini-2.5-flash";
const HANDOVER_TIMEOUT_MS = Number(process.env.MASTRA_CC_HANDOVER_TIMEOUT_MS ?? 10 * 60 * 1000);

// ONE DESK, ONE CONNECTION, for the life of the process. The instance IS the
// connection (ADR-0060), so re-dialling per request would give the daemon a new
// identity each turn and throw away the subscription book. Held in a module
// global because Next re-evaluates route modules on edit in development.
const globalDesk = globalThis as unknown as { __deskDemoDesk?: MastraCC };
function desk(): MastraCC {
  globalDesk.__deskDemoDesk ??= new MastraCC({ url: DESK_URL });
  return globalDesk.__deskDemoDesk;
}

// The prose the agent gets on top of the shipped instructions. It says only what
// the shipped text cannot know: that there is a person watching this particular
// desk, and how to reach them. Everything about HOW to read and act on the desk
// stays in INSTRUCTIONS, where it is version-controlled with the protocol.
const HANDOVER_INSTRUCTIONS = `
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

When a step should be done by that person rather than by you - signing in, entering
a password or a payment detail, accepting something only they can accept, or any
choice that is theirs to make - call requestHumanControl with a plain reason. That
unlocks the desk for them and stops you until they press Done. Do not attempt such a
step yourself, and do not guess a credential.

You cannot take control back. Control returns to you when the person says they are
done, and the tool tells you what they did or did not do. Read the desk again
afterwards rather than assuming the state you expected.
`.trim();

export function deskAgent(emit: (event: DemoEvent) => void) {
  // Every protocol frame leaves through a tool, so wrapping execute is a complete
  // record of what the agent asked the desk - the same trick the errand harness
  // uses, here to feed the transcript pane instead of a proof file.
  const wired = Object.fromEntries(
    Object.entries(desk().getTools()).map(([name, tool]) => [
      name,
      {
        ...tool,
        execute: async (...args: Parameters<NonNullable<typeof tool.execute>>) => {
          // Both shapes, because both are real: a tool's arguments arrive under
          // `context` in some versions of the agent framework and as the object
          // itself in others, and a transcript that silently logged `{}` for
          // every call would look like an agent calling tools with no arguments.
          const params = argumentsOf(args[0]);
          emit({ type: "tool", name, params });
          try {
            const result = await tool.execute!(...args);
            emit({ type: "tool-result", name, summary: summarise(result) });
            return result;
          } catch (error) {
            // A refusal that arrives as a thrown error is still the desk
            // answering. It belongs in the transcript, not in a stack trace.
            emit({ type: "tool-result", name, summary: message(error) });
            throw error;
          }
        },
      },
    ]),
  );

  const requestHumanControl = createTool({
    id: "requestHumanControl",
    description:
      "Hand the desk to the person watching it, and wait. Use for anything only they should do - signing in, a password, a payment, a decision that is theirs. The desk unlocks for them and you are blocked until they press Done. You cannot take control back yourself.",
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

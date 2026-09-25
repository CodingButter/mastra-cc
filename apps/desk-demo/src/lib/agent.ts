import { randomUUID } from "node:crypto";

import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { MastraCC, INSTRUCTIONS, isTransportConnectionError } from "@mastra-cc/desktop/mastra";
import { z } from "zod";
import { controlState, ControlWaitEndedError, requestControl } from "./control";
import { DeskCache } from "./desk-cache";
import type { DemoEvent } from "./events";

const DESK_URL = process.env.MASTRA_CC_URL ?? "ws://127.0.0.1:8787";
const MODEL = process.env.MASTRA_CC_MODEL ?? "google/gemini-3.8-flash";
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

This demo's configured Chromium saves directly to its downloads folder without a
file chooser. After Save image as…, inspect completion in chrome://downloads rather
than hunting for another Save button. Read the actual filename and destination;
a pending or failed download is not a saved file. This Chromium can open a saved
image through a file: address and show its pixel dimensions in the window title.
Measure the saved image, not the search preview, before using it.

This demo uses KDE Plasma. Its shell publishes taskbar buttons for running
applications, such as Dolphin and Chromium Web Browser. Discover the current
button and its Press action to raise the intended window; then query the destination
again for fresh IDs and confirm focus before typing. These are demo setup facts,
not guarantees about other desktops.

For this demo's wallpaper errand, System Settings is one route and Gwenview's
Set as Wallpaper menu is another. Discover the actual controls before using them.
If the settings grid remains unchanged after semantic and bounded pointer attempts,
try the viewer's GUI route rather than grinding on Apply or opening a terminal.
KDE's active wallpaper setting is in plasma-org.kde.plasma.desktop-appletsrc under
this desk's configuration directory; an image merely listed in plasmarc's
usersWallpapers is not proof that it became the wallpaper. Read the actual path
from this desk rather than inventing a home directory. Verify the active setting
and visible desktop outcome, not only an accepted Apply press.

A handover is something the desk showed you, so requestHumanControl refuses until you
have looked. Searching the web, downloading a file, opening a settings window and
changing a machine's own appearance are ordinary desktop work on this desk, not
boundaries: do them. The boundary is the person's identity, money, or private
judgement, and the desk will show it to you when you reach it.

requestHumanControl unlocks the desk and blocks you until the person presses Done.
You cannot take control back. When control returns, read the desk again before
continuing; never assume the requested step succeeded.
`.trim();

// Refusing a handover is an ANSWER to the agent, phrased the way the desk
// phrases its own refusals: what was wrong, and what to do instead.
export const HANDOVER_BEFORE_LOOKING = {
  handedBack: false,
  refused:
    "you have not looked at this desk yet, so this boundary is a guess rather than something the desk showed you",
  advice:
    "call listApplications, open what fits and read what appears; hand over once the desk itself shows a step only the person can take",
} as const;

export function deskAgent(
  emit: (event: DemoEvent) => void,
  onTerminalConnection: (error: Error) => void = () => {},
  signal?: AbortSignal,
) {
  const stopped = new AbortController();
  const turnSignal = signal ? AbortSignal.any([signal, stopped.signal]) : stopped.signal;
  const stop = (error: Error) => {
    stopped.abort(error);
    onTerminalConnection(error);
  };
  const desk = deskCache.get();
  // One turn's worth of memory, and it only remembers one thing: whether this
  // agent has looked at the desk yet. A handover asked for before the first
  // look is not a boundary the desk reported - it is a guess about what the
  // desk would have said (see requestHumanControl below).
  const looked = { yet: false };
  const wired = wiredDeskTools(desk, deskCache, emit, onTerminalConnection, isTransportConnectionError, () => {
    looked.yet = true;
  }, turnSignal);

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
      // The dogfood failure this exists for: asked to find a wallpaper and set
      // it, the agent answered "I cannot search the web, download files, or
      // change desktop settings" and handed the desk over having called NO
      // tool at all - on a desk that had a browser, a file manager and a
      // settings window on it. That is not a boundary, it is a guess about a
      // boundary, and prose alone did not stop it. So the tool refuses: a
      // handover has to be something the desk showed you, and you cannot have
      // been shown anything you never looked at. The refusal is a tool result,
      // not an error - it comes back as instructions to go and look, and the
      // agent is free to hand over the moment it has.
      turnSignal.throwIfAborted();
      if (!looked.yet) return HANDOVER_BEFORE_LOOKING;
      const { requestId, done } = requestControl(reason, HANDOVER_TIMEOUT_MS, turnSignal);
      emit({ type: "control", mode: "interact", reason, requestId });
      try {
        const note = await done;
        turnSignal.throwIfAborted();
        emit({ type: "control", mode: "view" });
        return { handedBack: true, note, advice: "read the desk again before continuing" };
      } catch (error) {
        // Ending the wait is not consent to end the person's control. Stop the
        // turn even when the model treats a failed tool as something to retry.
        stop(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
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
  // No default. A caller that forgets this argument would get a handover gate
  // that is permanently open and says nothing about it, so the compiler asks
  // instead of guessing.
  onDeskCall: () => void,
  signal?: AbortSignal,
): ReturnType<MastraCC["getTools"]> {
  const beforeDispatch = () => {
    signal?.throwIfAborted();
    if (controlState().mode === "interact") {
      const error = new ControlWaitEndedError("the person has control; no desktop tools may run until they press Done");
      onTerminalConnection(error);
      throw error;
    }
  };
  return Object.fromEntries(
    Object.entries(desk.getTools({ beforeDispatch })).map(([name, tool]) => [
      name,
      {
        ...tool,
        execute: async (...args: Parameters<NonNullable<typeof tool.execute>>) => {
          beforeDispatch();
          const params = argumentsOf(args[0]);
          const callId = `${CALL_ID_PREFIX}:${++callIdCounter}`;
          // The attempt counts, not the outcome. An agent that tried to read
          // the desk and got a refusal has heard from the desk; an agent that
          // never called has heard from nothing.
          onDeskCall();
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

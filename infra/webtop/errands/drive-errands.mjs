// Six errands, stated the way a person would state them, run against a real desk.
//
// This file knows the repository only as an installed dependency: `@mastra-cc/desktop`
// resolved out of a scratch project's node_modules, from a packed tarball. It dials a
// daemon in another namespace over the websocket door and gives a real model a real
// errand with the shipped INSTRUCTIONS and nothing else.
//
//   node drive-errands.mjs ws://<address>:<port> <errand-id> <run-index>
//
// It writes a verbatim transcript to stdout: every tool call, every argument, every
// result, the model's closing message, and the counts. It asserts NOTHING about the
// outcome - the transcript is evidence, and Phase 1's whole point is that the agent
// fails in ways worth writing down.
//
// NO RAW INPUT LIVES HERE. Pin B8 scans .mjs under infra/ as well as .sh, and the
// one errand-harness exemption is spent on run-errands.sh. When an errand needs the
// desk put into a state a human would have left it in, the shell wrapper does it
// before this process starts.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { MastraCC, INSTRUCTIONS } from "@mastra-cc/desktop/mastra";
import { Agent } from "@mastra/core/agent";

const [url, errandId, runIndex] = process.argv.slice(2);
if (!url || !errandId || !runIndex) throw new Error("usage: drive-errands.mjs <ws-url> <errand-id> <run-index>");

// The errand text is the user's sentence, unchanged between the baseline and the
// Phase 2 re-run. Phase 2 changes the INSTRUCTIONS, never these.
const ERRANDS = {
  E1: "Open a text editor and write a shopping list with three items, then save it.",
  E2: "In the file manager, find the file called proof.txt and rename it to receipt.txt.",
  E3: "Fill in the contact form on the page that is open in Chrome with my name and email, then submit it. My name is Dana Okonkwo and my email is dana@example.com.",
  E4: "Change the desktop wallpaper to a different one in system settings.",
  E5: "Read the total from the receipt open in Kate, then type it into the empty Mousepad document.",
  E6: "Close the editor without saving.",
};
const goal = ERRANDS[errandId];
if (!goal) throw new Error(`unknown errand ${errandId}`);

// Which prose is under test. Phase 2 re-runs this identical harness with one
// environment variable changed, so the transcript has to say which bytes it used -
// otherwise COMPARISON.md is measuring something it cannot name.
const instructionsPath = process.env.MASTRA_CC_ERRAND_INSTRUCTIONS;
const instructions = instructionsPath ? readFileSync(instructionsPath, "utf8") : INSTRUCTIONS;
const instructionsSha = createHash("sha256").update(instructions).digest("hex");

const model = process.env.MASTRA_CC_MODEL ?? "google/gemini-2.5-flash";
const maxSteps = Number(process.env.MASTRA_CC_ERRAND_STEPS ?? 24);
const temperature = Number(process.env.MASTRA_CC_ERRAND_TEMPERATURE ?? 0);

// THE HEADER. `MASTRA_CC_MODEL` is a plain environment variable, so a Phase 2
// re-run on a drifted default would silently swap the instrument. Every one of
// these lines exists so a reader can tell whether two transcripts are comparable.
console.log(`errand: ${errandId}`);
console.log(`run: ${runIndex}`);
console.log(`model: ${model}`);
console.log(`sampling: ${JSON.stringify({ temperature, maxSteps })}`);
console.log(`instructions-source: ${instructionsPath ?? "@mastra-cc/desktop INSTRUCTIONS"}`);
console.log(`instructions-sha256: ${instructionsSha}`);
console.log(`instructions-bytes: ${Buffer.byteLength(instructions)}`);
console.log(`goal: ${goal}`);
console.log("--");

const desk = new MastraCC({ url });

// Every protocol frame this process sends leaves through a tool - the client is
// private to the instance. Wrapping execute is therefore a complete record of what
// the agent asked the desk, in order, with what it got back.
let calls = 0;
const tools = Object.fromEntries(
  Object.entries(desk.getTools()).map(([name, tool]) => [
    name,
    {
      ...tool,
      execute: async (...args) => {
        calls += 1;
        const n = calls;
        console.log(`call ${n}: ${name} ${JSON.stringify(args[0]?.context ?? args[0] ?? {})}`);
        try {
          const result = await tool.execute(...args);
          console.log(`result ${n}: ${JSON.stringify(result).slice(0, 1200)}`);
          return result;
        } catch (error) {
          // A refusal that arrives as a thrown error is still the desk answering.
          // It belongs in the transcript verbatim, not swallowed into a stack trace.
          console.log(`error ${n}: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
      },
    },
  ]),
);

const agent = new Agent({
  id: "errand-runner",
  name: "errand-runner",
  instructions,
  model,
  tools,
});

let text = "";
let failure = null;
try {
  const answer = await agent.generate(goal, { maxSteps, modelSettings: { temperature } });
  text = String(answer.text ?? "").trim();
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

console.log("--");
console.log(`final-message: ${JSON.stringify(text)}`);
console.log(`tool-calls: ${calls}`);
console.log(`outcome: ${failure ? `threw: ${failure}` : "the run completed"}`);
await desk.close();
// Exit 0 whether or not the errand succeeded. A failed errand is the DATA this
// phase is collecting; a non-zero exit here would stop the sweep at the first
// interesting result.
process.exit(0);

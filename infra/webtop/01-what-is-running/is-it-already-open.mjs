// An agent asks whether an application is already open, before opening it.
//
// It knows this repository only as an installed dependency: `@mastra-cc/desktop`
// resolved out of a scratch project's node_modules, from a packed tarball. It
// dials a daemon in another namespace over the websocket door.
//
// The errand is three beats: ask whether the editor is running, open it, ask
// again. What makes it a proof rather than a demo is WHERE the answers come
// from - `listApplications`, on both sides of the launch. A model that
// remembers having pressed the button can say "running" without the desk
// telling it anything, so the harness reads the same field itself, out of band,
// and the verdict is the DAEMON's two answers. The model's two answers are
// recorded next to them and must agree.
//
//   node is-it-already-open.mjs ws://<address>:<port>
import { MastraCC } from "@mastra-cc/desktop/mastra";
import { Agent } from "@mastra/core/agent";

const url = process.argv[2];
if (!url) throw new Error("a websocket url is required");

const APPLICATION = "org.kde.kate";
const HUMAN = "the text editor";
const RUNS_AS = /kate/i;

const log = (step, detail) => console.log(`${step}: ${JSON.stringify(detail)}`);

const desk = new MastraCC({ url });
const client = await desk.client();

// The field under test, read by the harness rather than by the model. `running`
// is absent entirely on a daemon built before schema 1.7.0 - which is exactly
// what the red side is measuring, so undefined is reported and never defaulted.
const askTheDaemon = async () => {
  const { applications } = await client.listApplications({});
  const entry = applications.find((application) => application.name === APPLICATION);
  return entry
    ? { found: true, running: entry.running, unknownBy: entry.runningUnknownBy, launchable: entry.launchable }
    : { found: false };
};
const roots = async () =>
  (await client.queryElements({ role: "application", limit: 50 })).elements.map((element) => element.name);

let protocolCalls = 0;
const tools = Object.fromEntries(
  Object.entries(desk.getTools()).map(([name, tool]) => [
    name,
    {
      ...tool,
      execute: async (...args) => {
        protocolCalls += 1;
        console.log(`tool-call: ${JSON.stringify({ n: protocolCalls, name })}`);
        return tool.execute(...args);
      },
    },
  ]),
);

const agent = new Agent({
  id: "is-it-already-open",
  name: "is-it-already-open",
  instructions: [
    "You operate a real Linux desktop through the mastra-cc tools.",
    "Answer only from what the tools report to you in THIS message - never from what you did earlier.",
    "listApplications is how you learn what the machine has and what it is doing.",
    "Never claim something you have not observed.",
  ].join(" "),
  model: process.env.MASTRA_CC_MODEL ?? "google/gemini-2.5-flash",
  tools,
});

const ASK =
  `Using listApplications, is ${HUMAN} (${APPLICATION}) running on this desktop right now? ` +
  `Reply with exactly one word: RUNNING, NOT-RUNNING, or UNKNOWN. Use UNKNOWN if what the tool ` +
  `reports does not actually say whether it is running.`;
const word = (said) => (said.text ?? "").toUpperCase().match(/NOT-RUNNING|RUNNING|UNKNOWN/)?.[0] ?? "(no answer)";

// ---- beat 0: it really is not running --------------------------------------
const before = await roots();
log("application-roots-before-anything", before);
if (before.some((name) => RUNS_AS.test(name ?? ""))) {
  console.log(JSON.stringify({ proof: "red", reason: `${APPLICATION} was already running before the errand began` }));
  await desk.close();
  process.exit(1);
}

// ---- beat 1: ask a closed desk ---------------------------------------------
const daemonSaidBefore = await askTheDaemon();
log("the-daemon-before-the-launch", daemonSaidBefore);
const saidBefore = await agent.generate(ASK, { maxSteps: 8 });
const modelSaidBefore = word(saidBefore);
log("the-model-before-the-launch", { word: modelSaidBefore, said: (saidBefore.text ?? "").trim().slice(0, 300) });

// ---- beat 2: the agent opens it itself -------------------------------------
const opened = await agent.generate(
  `Open ${HUMAN}, which listApplications calls ${APPLICATION}. Reply DONE when the tool has accepted it.`,
  { maxSteps: 8 },
);
log("the-launch", (opened.text ?? "").trim().slice(0, 160));

// The bus publishes a new toplevel a moment after the process is up. Settle
// against the DESK (an application root appearing), never against the field
// under test - waiting for `running` to say what we want would make the wait
// itself the answer.
let appeared = [];
for (let attempt = 0; attempt < 15 && appeared.length === 0; attempt += 1) {
  appeared = (await roots()).filter((name) => RUNS_AS.test(name ?? ""));
  if (appeared.length === 0) await new Promise((resolve) => setTimeout(resolve, 1000));
}
log("application-roots-after-the-launch", appeared);

// ---- beat 3: ask an open desk ----------------------------------------------
const daemonSaidAfter = await askTheDaemon();
log("the-daemon-after-the-launch", daemonSaidAfter);
const saidAfter = await agent.generate(ASK, { maxSteps: 8 });
const modelSaidAfter = word(saidAfter);
log("the-model-after-the-launch", { word: modelSaidAfter, said: (saidAfter.text ?? "").trim().slice(0, 300) });

// ---- the verdict ------------------------------------------------------------
// Green is a CHANGE the daemon reports across the launch, plus a model that
// said the same thing without being told. A daemon that answered "answering"
// both times, or a field that never existed, is red.
const problems = [];
if (daemonSaidBefore.running === undefined || daemonSaidAfter.running === undefined) {
  problems.push("the daemon's listApplications carries no running state at all - it cannot say what is open");
}
if (daemonSaidBefore.running !== "not-answering") {
  problems.push(`before the launch the daemon said ${JSON.stringify(daemonSaidBefore.running)}, not not-answering`);
}
if (daemonSaidAfter.running !== "answering") {
  problems.push(`after the launch the daemon said ${JSON.stringify(daemonSaidAfter.running)}, not answering`);
}
if (modelSaidBefore !== "NOT-RUNNING") problems.push(`the model said ${modelSaidBefore} about a closed editor`);
if (modelSaidAfter !== "RUNNING") problems.push(`the model said ${modelSaidAfter} about an open editor`);
if (appeared.length === 0) problems.push("no application root ever appeared - the launch itself failed");

console.log(
  JSON.stringify({
    proof: problems.length === 0 ? "green" : "red",
    application: APPLICATION,
    daemon: `${JSON.stringify(daemonSaidBefore.running)} -> ${JSON.stringify(daemonSaidAfter.running)}`,
    model: `${modelSaidBefore} -> ${modelSaidAfter}`,
    toolCalls: protocolCalls,
    ...(problems.length ? { reason: problems } : {}),
  }),
);
await desk.close();
process.exit(problems.length === 0 ? 0 : 1);

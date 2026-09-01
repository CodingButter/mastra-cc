// A deaf desk, and an agent asked to read it.
//
// The harness switches this machine's accessibility layer OFF before the daemon
// starts. Every query then comes back empty - which on the base daemon is
// indistinguishable from a desktop with nothing on it, and that false belief is
// the whole thing this segment exists to end.
//
// The model is asked one question with three honest answers, and the daemon's
// own answer is read out of band next to it. A model that says "the layer is
// off" because it guessed would be indistinguishable from one that was told, so
// the verdict is the DAEMON's report; the model's word must merely agree.
//
//   node is-the-desk-deaf.mjs ws://<address>:<port>
import { MastraCC } from "@mastra-cc/desktop/mastra";
import { Agent } from "@mastra/core/agent";

const url = process.argv[2];
if (!url) throw new Error("a websocket url is required");

const log = (step, detail) => console.log(`${step}: ${JSON.stringify(detail)}`);

const desk = new MastraCC({ url });
const client = await desk.client();

// The two routes under test, read by the harness rather than by the model. Both
// are absent on a daemon built before schema 1.8.0, which is exactly what the
// red side measures - so an absent route is reported as absent, never defaulted.
const describe = async () => {
  if (typeof client.describeAccessibility !== "function") return { route: "absent" };
  try {
    return { route: "present", ...(await client.describeAccessibility({})) };
  } catch (error) {
    return { route: "present", threw: String(error).slice(0, 200) };
  }
};
const acquire = async () => {
  if (typeof client.acquireAccessibility !== "function") return { route: "absent" };
  try {
    return { route: "present", ...(await client.acquireAccessibility({})) };
  } catch (error) {
    return { route: "present", threw: String(error).slice(0, 200) };
  }
};
const windows = async () =>
  (await client.queryElements({ role: "window", limit: 20 })).elements.map((element) => element.name);

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
  id: "is-the-desk-deaf",
  name: "is-the-desk-deaf",
  instructions: [
    "You operate a real Linux desktop through the mastra-cc tools.",
    "Answer only from what the tools report to you in THIS message - never from what you assume about desktops.",
    "An empty result is not evidence that something is absent; say so plainly when you cannot tell.",
    "Never claim something you have not observed.",
  ].join(" "),
  model: process.env.MASTRA_CC_MODEL ?? "google/gemini-2.5-flash",
  tools,
});

const ASK =
  "Look at this desktop and tell me why you can or cannot read what is on it. " +
  "Reply with exactly one word on its own line: WINDOWS if you can see windows, " +
  "DEAF if the machine's accessibility layer is switched off, or EMPTY if the desktop " +
  "genuinely has nothing on it. Then one short sentence saying how you know.";
const word = (said) => (said.text ?? "").toUpperCase().match(/WINDOWS|DEAF|EMPTY/)?.[0] ?? "(no answer)";

// ---- beat 1: a deaf desk ----------------------------------------------------
const seen = await windows();
log("windows-visible-while-deaf", seen);
const daemonWhileDeaf = await describe();
log("the-daemon-while-deaf", daemonWhileDeaf);
const saidDeaf = await agent.generate(ASK, { maxSteps: 8 });
const modelWhileDeaf = word(saidDeaf);
log("the-model-while-deaf", { word: modelWhileDeaf, said: (saidDeaf.text ?? "").trim().slice(0, 400) });

// ---- beat 2: the operator's daemon switches the layer on --------------------
// The AGENT never asks for this: the route the harness calls here is the one the
// operator authorised with a launch flag. The model is not in this beat at all.
const acquired = await acquire();
log("the-acquire-attempt", acquired);
await new Promise((resolve) => setTimeout(resolve, 3000));

const daemonAfter = await describe();
log("the-daemon-after-the-acquire", daemonAfter);

// ---- the verdict ------------------------------------------------------------
const problems = [];
if (daemonWhileDeaf.route === "absent") {
  problems.push("this daemon has no describeAccessibility route - a silent desk cannot be told from an empty one");
}
if (daemonWhileDeaf.accessibility?.state !== "disabled") {
  problems.push(`while deaf the daemon reported ${JSON.stringify(daemonWhileDeaf.accessibility?.state)}, not disabled`);
}
if (modelWhileDeaf !== "DEAF") {
  problems.push(`the model said ${modelWhileDeaf} about a desk whose accessibility layer was switched off`);
}
if (acquired.route === "absent") problems.push("this daemon has no acquireAccessibility route");
if (acquired.accessibility?.state !== "enabled") {
  problems.push(`the acquire reported ${JSON.stringify(acquired.accessibility?.state ?? acquired.refusal)}, not enabled`);
}
if (daemonAfter.accessibility?.state !== "enabled") {
  problems.push(`after the acquire the daemon still reported ${JSON.stringify(daemonAfter.accessibility?.state)}`);
}

console.log(
  JSON.stringify({
    proof: problems.length === 0 ? "green" : "red",
    daemon: `${JSON.stringify(daemonWhileDeaf.accessibility?.state)} -> ${JSON.stringify(daemonAfter.accessibility?.state)}`,
    model: modelWhileDeaf,
    toolCalls: protocolCalls,
    ...(problems.length ? { reason: problems } : {}),
  }),
);
await desk.close();
process.exit(problems.length === 0 ? 0 : 1);

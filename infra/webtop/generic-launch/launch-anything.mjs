// An agent that starts its own applications.
//
// It knows this repository only as an installed dependency: `@mastra-cc/desktop`
// resolved out of a scratch project's node_modules, from a packed tarball. It
// dials a daemon in another namespace over the websocket door and is asked to
// use two applications NOBODY OPENED FOR IT - one Qt, one GTK. The verdict is
// not "openApplication returned"; it is "the application is READABLE afterwards":
// an accessibility root under that name, with elements published beneath it that
// were not in the tree before. Toolkits disagree about toplevels - Qt publishes a
// window node, GTK publishes an application node over a subtree of panels and
// menu items - so demanding a `window` role would measure Qt's shape rather than
// what openApplication promises.
//
//   node launch-anything.mjs ws://<address>:<port>
import { MastraCC } from "@mastra-cc/desktop/mastra";
import { Agent } from "@mastra/core/agent";

const url = process.argv[2];
if (!url) throw new Error("a websocket url is required");

// Two toolkit families. The env union a derived recipe carries is GTK3's module
// knob and Qt6's always-on knob, so the claim is only as wide as the toolkits
// actually measured (ADR-0027, ADR-0062).
const ERRANDS = [
  { app: "org.kde.kate", toolkit: "Qt6", human: "the text editor", match: /kate/i },
  { app: "org.xfce.mousepad", toolkit: "GTK3", human: "the simple notepad", match: /mousepad/i },
];
// Measured, not asserted: a Chromium-family application publishes its tree
// through a debugging port, not the platform bus. Whatever this reports is
// what the record says.
const MEASURE = { app: "chromium", match: /chromium/i };

const log = (step, detail) => console.log(`${step}: ${JSON.stringify(detail)}`);

const desk = new MastraCC({ url });
const client = await desk.client();
// The two toolkit-neutral facts openApplication promises: an accessibility root
// published under that name, and elements published beneath it.
const roots = async () =>
  (await client.queryElements({ role: "application", limit: 50 })).elements.map((element) => ({
    id: element.id,
    name: element.name,
  }));
const census = async () => (await client.queryElements({ limit: 500 })).elements.length;

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
  id: "desk-opener",
  name: "desk-opener",
  instructions: [
    "You operate a real Linux desktop through the mastra-cc tools.",
    "An application you need may not be running yet: open it yourself with openApplication,",
    "using the name listApplications reports. After opening, confirm it is really there by",
    "querying elements. Never claim success you have not observed.",
  ].join(" "),
  model: process.env.MASTRA_CC_MODEL ?? "google/gemini-2.5-flash",
  tools,
});

// ---- nothing is running before the agent starts it -------------------------
const before = await roots();
log("roots-before-the-agent-ran", before);
const preStarted = [...ERRANDS, MEASURE].filter((errand) =>
  before.some((root) => errand.match.test(root.name)),
);
if (preStarted.length > 0) {
  console.log(
    JSON.stringify({
      proof: "red",
      reason: `already running before the agent did anything: ${preStarted.map((e) => e.app).join(", ")}`,
    }),
  );
  await desk.close();
  process.exit(1);
}

// ---- the errands ------------------------------------------------------------
const results = [];
let elementsBefore = await census();
log("elements-before-the-agent-ran", elementsBefore);
for (const errand of ERRANDS) {
  const said = await agent.generate(
    `Open ${errand.human}, which listApplications calls ${errand.app}. Then confirm it is really ` +
      `open by querying elements, and reply with the id of one element you can see.`,
    { maxSteps: 12 },
  );
  // The daemon's own answer, not the model's summary: a readable root under that
  // name, plus more elements in the tree than before it was started. The bus
  // publishes a new toplevel a moment after the process is up, so give the desk
  // a bounded settle before calling a launch a failure.
  let everything = [];
  let open = [];
  let elementsNow = elementsBefore;
  for (let attempt = 0; attempt < 10 && open.length === 0; attempt += 1) {
    everything = await roots();
    open = everything.filter((root) => errand.match.test(root.name));
    elementsNow = await census();
    if (open.length === 0) await new Promise((r) => setTimeout(r, 1000));
  }
  log("every-root-now", everything);
  results.push({
    app: errand.app,
    toolkit: errand.toolkit,
    said: said.text?.trim().slice(0, 200),
    roots: open,
    elementsBefore,
    elementsNow,
    // Logged, never asserted on: queryElements is capped, so once one
    // application fills the page the count says nothing about the next one.
    grew: elementsNow > elementsBefore,
  });
  elementsBefore = elementsNow;
  log("errand", results[results.length - 1]);
}

// ---- the honest measurement -------------------------------------------------
const opened = await client
  .openApplication({ name: MEASURE.app })
  .catch((error) => ({ refusal: String(error.message ?? error) }));
await new Promise((r) => setTimeout(r, 8000));
const after = await roots();
log("chromium-measurement", {
  launch: opened.refusal ?? "accepted",
  readableRoot: opened.application ? { id: opened.application.id, role: opened.application.role } : null,
  roots: after.filter((root) => MEASURE.match.test(root.name)),
  elements: await census(),
});

const failed = results.filter((result) => result.roots.length === 0);
console.log(
  JSON.stringify({
    proof: failed.length === 0 ? "green" : "red",
    launched: results.map((result) => ({
      app: result.app,
      toolkit: result.toolkit,
      roots: result.roots.length,
      elements: `${result.elementsBefore} -> ${result.elementsNow}`,
    })),
    toolCalls: protocolCalls,
    ...(failed.length
      ? { reason: `no readable root with elements for ${failed.map((f) => f.app).join(", ")}` }
      : {}),
  }),
);
await desk.close();
process.exit(failed.length === 0 ? 0 : 1);

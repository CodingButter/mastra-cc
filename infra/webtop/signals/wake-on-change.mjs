// An agent that stops asking and gets told.
//
// It knows this repository only as an installed dependency: `@mastra-cc/desktop`
// resolved out of a scratch project's node_modules, from a packed tarball. It
// dials a daemon in another namespace over the websocket door, asks the desk one
// question - where is the document, watch it for me - and then STOPS CALLING
// TOOLS. Everything after that arrives because the desk spoke first.
//
//   node wake-on-change.mjs ws://<address>:<port>
import { MastraCC } from "@mastra-cc/desktop/mastra";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { createClient } from "@libsql/client";

const url = process.argv[2];
if (!url) throw new Error("a websocket url is required");
const documentName = process.env.MASTRA_CC_DOCUMENT_NAME ?? "proof.txt";
const dbUrl = process.env.MASTRA_CC_WAKE_DB ?? "file:/tmp/wake-proof.db";
const threadId = "desk-watch";
const resourceId = "the-agent";

const log = (step, detail) => console.log(`${step}: ${JSON.stringify(detail)}`);

const desk = new MastraCC({ url });

// THE COUNTER. In this process a protocol frame can only leave through a tool -
// the client is private to the instance and nothing else holds a reference to
// it. So counting tool executions counts the frames this process sent. The
// daemon's own audit log is the second, independent count (see proof.sh).
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

const store = new LibSQLStore({ id: "wake-proof", url: dbUrl });
const provider = desk.getSignalProvider({ threadId, resourceId });
const agent = new Agent({
  id: "desk-watcher",
  name: "desk-watcher",
  instructions: [
    "You watch one element on a real desktop through the mastra-cc tools.",
    "Names are not identifiers: find the element by id and use the id.",
    "When a desktop signal wakes you, do NOT call any tool. Answer in one line,",
    "starting with the word WOKEN, quoting the signal summary you were given.",
  ].join(" "),
  model: process.env.MASTRA_CC_MODEL ?? "google/gemini-2.5-flash",
  memory: new Memory({ storage: store }),
  tools,
  // The provider is attached HERE and only here: notify() throws unless the
  // provider was handed to a live Agent constructor. An editor-configured agent
  // cannot carry one (ADR-0061).
  signals: [provider],
});
new Mastra({ agents: { agent }, storage: store });

const memory = await agent.getMemory();
await memory.createThread({ threadId, resourceId, title: "watching the desk" });

// ---- the one question the agent asks --------------------------------------
const asked = await agent.generate(
  `Find the visible writable text element named ${documentName} and subscribe to it with priority high. ` +
    `Reply with the element id and the subscription id.`,
  { memory: { thread: threadId, resource: resourceId }, maxSteps: 10 },
);
log("agent-asked", { text: asked.text?.trim().slice(0, 200), toolCalls: protocolCalls });

// A passive observer on the instance's own connection - no second dial, no
// frame sent - so the transcript can say how fast a real desk actually talks
// and the throttle window stops being a guess.
const seen = [];
(await desk.client()).onChangeEvent((event) => seen.push(event.at));

const callsBeforeIdle = protocolCalls;
const messagesBefore = await countMessages();
console.log(`SUBSCRIBED: ${JSON.stringify({ callsSoFar: callsBeforeIdle, messages: messagesBefore })}`);
console.log("IDLE: the agent is now calling nothing. Mutate the element from the desktop.");

// ---- the desk speaks first -------------------------------------------------
const deadline = Date.now() + Number(process.env.MASTRA_CC_WAKE_TIMEOUT_MS ?? 90000);
let woke = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1000));
  const rows = await messagesAfter(messagesBefore);
  const assistant = rows.filter((row) => row.role === "assistant");
  if (assistant.length > 0) {
    woke = assistant[assistant.length - 1];
    break;
  }
}

const framesBetween = protocolCalls - callsBeforeIdle;
if (!woke) {
  console.log(JSON.stringify({ proof: "red", reason: "no wake within the deadline", framesBetween }));
  await desk.close();
  process.exit(1);
}

log("woken", { text: String(woke.text).slice(0, 400) });
log("frames-between-subscribe-and-wake", framesBetween);

// The RECORD, not the input object the provider handed to Mastra. Persistence is
// where a field silently disappears, and the delivery policy reads the record.
const watch = /watch (sub-[\w-]+)/.exec(String(woke.text))?.[1];
const record = await deliveredRecord(watch);
log("delivered-record", record);
const wrong =
  record.status !== "delivered"
    ? `the record says ${record.status}: it was stored but nothing was woken`
    : record.priority !== "high"
    ? `the subscriber chose priority high; the stored record says ${record.priority}`
    : record.attribution !== "external"
      ? `attribution ${record.attribution} should never have woken anyone`
      : // Not the general guard - the pointer-only FORMAT is asserted by unit
        // test. This only catches this run's own text leaking into a summary.
        /INSTALLABLE|EXTERNAL EDIT|burst-/.test(record.summary)
        ? `the summary carries the element's content: ${record.summary}`
        : null;
if (wrong) {
  console.log(JSON.stringify({ proof: "red", reason: wrong }));
  await desk.close();
  process.exit(1);
}

// How fast does a real desk actually talk? Measured, not assumed: the window
// below is the one the throttle is set against.
console.log("OBSERVING: keep typing");
await new Promise((r) => setTimeout(r, Number(process.env.MASTRA_CC_OBSERVE_MS ?? 15000)));
const span = seen.length > 1 ? (seen[seen.length - 1] - seen[0]) / 1000 : 0;
log("observed-event-rate", {
  events: seen.length,
  spanSeconds: Number(span.toFixed(2)),
  perSecond: span > 0 ? Number((seen.length / span).toFixed(2)) : null,
  wakes: (await messagesAfter(messagesBefore)).filter((row) => row.role === "assistant").length,
});
console.log(
  JSON.stringify({
    proof: framesBetween === 0 ? "green" : "red",
    framesBetween,
    callsBeforeIdle,
    woken: String(woke.text).slice(0, 200),
  }),
);
await desk.close();
process.exit(framesBetween === 0 ? 0 : 1);

async function deliveredRecord(watch) {
  // `attributes` is stored as a blob; reading it as text makes the driver panic
  // on invalid utf-8, so take the hex and pull the two strings that matter out
  // of it rather than pretending to parse a format nobody documented here.
  const raw = await createClient({ url: dbUrl }).execute(
    "select priority, status, summary, hex(attributes) as attributes from mastra_notifications " +
      "where summary like ? order by createdAt limit 1",
    [`%${watch}%`],
  );
  if (raw.rows.length === 0) throw new Error(`no stored notification for ${watch}`);
  const row = raw.rows[0];
  const blob = Buffer.from(row.attributes ?? "", "hex").toString("latin1");
  return {
    priority: row.priority,
    status: row.status,
    summary: row.summary,
    attribution: /attribution.(self|external|unattributed)/.exec(blob)?.[1] ?? null,
  };
}

async function countMessages() {
  const raw = await createClient({ url: dbUrl }).execute("select count(*) as n from mastra_messages");
  return Number(raw.rows[0].n);
}

async function messagesAfter(n) {
  const raw = await createClient({ url: dbUrl }).execute(
    "select role, content from mastra_messages order by createdAt limit -1 offset ?",
    [n],
  );
  return raw.rows.map((row) => ({ role: row.role, text: textOf(row.content) }));
}

function textOf(content) {
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    if (typeof parsed?.content === "string") return parsed.content;
    if (Array.isArray(parsed?.parts)) return parsed.parts.map((p) => p.text ?? "").join("");
    if (Array.isArray(parsed?.content)) return parsed.content.map((p) => p.text ?? "").join("");
    return JSON.stringify(parsed);
  } catch {
    return String(content);
  }
}

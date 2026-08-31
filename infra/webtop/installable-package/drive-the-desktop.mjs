// An agent process that knows this repository only as a dependency.
//
// It imports `@mastra-cc/desktop` by NAME, resolved out of a scratch project's
// node_modules from a packed tarball - no workspace resolution, no source
// import, no relative path into this checkout. It dials a daemon in another
// namespace over the websocket door, and does the whole loop the shipped
// instructions describe: find, read, write, verify by fresh read, subscribe,
// observe the self-attributed event, unsubscribe, close.
//
//   node drive-the-desktop.mjs ws://<address>:<port>
import { connect, INSTRUCTIONS } from "@mastra-cc/desktop";

const url = process.argv[2];
if (!url) throw new Error("a websocket url is required");
const documentName = process.env.MASTRA_CC_DOCUMENT_NAME ?? "proof.txt";
const sentence = `INSTALLABLE PACKAGE PROOF ${new Date().toISOString()}`;

const log = (step, detail) => console.log(`${step}: ${JSON.stringify(detail)}`);

// The instructions are the package's, not this script's: an agent handed the
// tools is handed this text too, and it is what tells it that a returned call
// is not proof the desktop changed.
log("instructions", { chars: INSTRUCTIONS.length, firstLine: INSTRUCTIONS.split("\n")[0] });

const client = await connect({ url });
try {
  const all = (await client.queryElements({ limit: 1000 })).elements;
  const applications = all.filter((element) => element.role === "application").map((element) => element.name);
  log("applications", applications);

  // Names are not identifiers - the id is. The visible editor document is the
  // one that is writable and not redacted, not merely the one that shares a name.
  const document = all.find(
    (element) =>
      element.role === "text" &&
      element.name === documentName &&
      element.states.includes("visible") &&
      element.operations?.some((o) => o.operation === "setText" && o.availability === "available") &&
      element.content?.kind !== "redacted",
  );
  if (!document) throw new Error(`no visible writable document named ${documentName}`);
  log("found", { id: document.id, role: document.role, name: document.name });

  const before = await client.readElementContent({ id: document.id, offset: 0, limit: 4096 });
  log("read-before", { kind: before.content?.kind, chars: before.content?.value?.length ?? null });

  const watch = await client.subscribeElement({ id: document.id, priority: "medium" });
  if (!watch.subscription) throw new Error(watch.refusal ?? "subscribe returned no subscription");
  const { subscriptionId } = watch.subscription;
  log("subscribed", { subscriptionId });

  const events = [];
  client.onChangeEvent((event) => events.push(event));

  const written = await client.setElementText({ id: document.id, text: sentence });
  if (!written.element) throw new Error(written.refusal ?? "setElementText returned no element");
  log("wrote", { sentence });

  // A returned call is not proof. The fresh read is.
  const after = await client.readElementContent({ id: document.id, offset: 0, limit: 4096 });
  if (after.content?.value !== sentence) {
    throw new Error(`fresh read did not equal what was written: ${JSON.stringify(after.content)}`);
  }
  log("verified", { equal: true, chars: after.content.value.length });

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const mine = events.filter((event) => event.subscriptionId === subscriptionId);
  log("events", { count: mine.length, kinds: [...new Set(mine.map((e) => e.kind))], attribution: [...new Set(mine.map((e) => e.attribution))] });
  if (mine.length === 0) throw new Error("no change event arrived for the element this process edited");
  if (mine.some((event) => "content" in event)) throw new Error("a change event carried content");

  const stopped = await client.unsubscribeElement({ subscriptionId });
  if (stopped.ended !== true) throw new Error(stopped.refusal ?? "the watch did not end");
  log("unsubscribed", { subscriptionId, ended: stopped.ended });

  console.log(JSON.stringify({ proof: "green", elementId: document.id, sentence, events: mine.length }));
} finally {
  await client.close();
}

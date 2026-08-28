import { connect } from "/opt/mastra-cc/transport/index.mjs";

const socketPath = process.env.MASTRA_CC_SOCKET;
if (!socketPath) throw new Error("MASTRA_CC_SOCKET is required");
const mode = process.argv[2];
const sentence = process.env.MASTRA_CC_PROOF_SENTENCE;
const documentName = process.env.MASTRA_CC_DOCUMENT_NAME ?? "proof.txt";
const client = await connect({ socketPath });

async function elements() {
  return (await client.queryElements({ limit: 1000 })).elements;
}

// The observation is returned in reading order, one application subtree at a time,
// so an application's own elements are those between it and the next application.
function withinApplication(all, application) {
  const start = all.findIndex((element) => element.role === "application" && element.name === application);
  if (start === -1) throw new Error(`application was not semantically observable: ${application}`);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((element) => element.role === "application");
  return end === -1 ? rest : rest.slice(0, end);
}

try {
  if (mode === "applications") {
    console.log(JSON.stringify((await elements()).filter((element) => element.role === "application").map((element) => element.name)));
  } else if (mode === "readiness") {
    const all = await elements();
    if (!all.some((element) => element.role === "application" && element.name === "kate")) {
      throw new Error("Kate is not semantically readable");
    }
    console.log("READINESS: GREEN");
  } else if (mode === "semantic") {
    if (!sentence) throw new Error("MASTRA_CC_PROOF_SENTENCE is required");
    const all = await elements();
    // The visible document is the editor's own named text control, not one of the
    // hidden auxiliary text controls (search bar, filter boxes) Kate also publishes.
    const editable = withinApplication(all, "kate").find(
      (element) =>
        element.role === "text" &&
        element.name === documentName &&
        element.states.includes("visible") &&
        element.operations?.some((operation) => operation.operation === "setText" && operation.availability === "available") &&
        element.content?.kind !== "redacted",
    );
    if (!editable) throw new Error(`the visible editor document was not semantically observable: ${documentName}`);
    const attested = await client.attestElement({ id: editable.id });
    if (!attested.element) throw new Error(attested.refusal ?? "attestElement returned no element");
    const written = await client.setElementText({ id: editable.id, text: sentence });
    if (!written.element) throw new Error(written.refusal ?? "setElementText returned no element");
    const fresh = (await elements()).find((element) => element.id === editable.id);
    if (!fresh) throw new Error("edited element was absent from fresh observation");
    if (fresh.content === undefined) throw new Error("observable content absent after successful write");
    if (!((fresh.content.kind === "text" || fresh.content.kind === "text-window") && fresh.content.value === sentence)) {
      throw new Error("observable content did not equal the exact sentence after re-query");
    }
    console.log(JSON.stringify({ semantic: "green", elementId: editable.id, sentence }));
  } else if (mode === "subscribe") {
    if (!sentence) throw new Error("MASTRA_CC_PROOF_SENTENCE is required");
    const all = await elements();
    const editable = withinApplication(all, "kate").find(
      (element) => element.role === "text" && element.name === documentName && element.states.includes("visible"),
    );
    if (!editable) throw new Error(`the visible editor document was not semantically observable: ${documentName}`);
    const watch = await client.subscribeElement({ id: editable.id, priority: "medium" });
    if (!watch.subscription) throw new Error(watch.refusal ?? "subscribeElement returned no subscription");
    const heard = [];
    const stop = client.onChangeEvent((event) => {
      if (event.subscriptionId === watch.subscription.subscriptionId) heard.push(event);
    });
    const written = await client.setElementText({ id: editable.id, text: sentence });
    if (!written.element) throw new Error(written.refusal ?? "setElementText returned no element");
    const deadline = Date.now() + 5000;
    while (heard.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    stop();
    if (heard.length === 0) throw new Error("the watched subtree changed and no change event arrived");
    // The event is a pointer, never a payload: content only ever arrives through a
    // fresh authorized read that runs the visibility gate again.
    for (const event of heard) {
      if ("content" in event || "value" in event || "text" in event) throw new Error("a change event carried content");
      if (JSON.stringify(event).includes(sentence)) throw new Error("a change event carried the written sentence");
    }
    const read = await client.readElementContent({ id: editable.id, offset: 0, limit: 4096 });
    if (!read.content) throw new Error(read.refusal ?? "readElementContent returned no content");
    if (!((read.content.kind === "text" || read.content.kind === "text-window") && read.content.value === sentence)) {
      throw new Error("re-read after the change event did not equal the exact sentence");
    }
    await client.unsubscribeElement({ subscriptionId: watch.subscription.subscriptionId });
    console.log(JSON.stringify({ subscription: "green", elementId: editable.id, events: heard.length, kinds: [...new Set(heard.map((event) => event.kind))], attribution: [...new Set(heard.map((event) => event.attribution))] }));
  } else if (mode === "persistence") {
    if (!sentence) throw new Error("MASTRA_CC_PROOF_SENTENCE is required");
    const control = (await elements()).find((element) => element.name === "Persistence proof control");
    if (!control) throw new Error("persistence control was not semantically observable");
    await client.setElementText({ id: control.id, text: sentence });
    const fresh = (await elements()).find((element) => element.id === control.id);
    if (!fresh || !((fresh.content.kind === "text" || fresh.content.kind === "text-window") && fresh.content.value === sentence)) {
      throw new Error("persistence control did not expose the exact sentence after mutation");
    }
    console.log(JSON.stringify({ persistence: "written", elementId: control.id }));
  } else if (mode === "verify-persistence") {
    if (!sentence) throw new Error("MASTRA_CC_PROOF_SENTENCE is required");
    const observed = (await elements()).find(
      (element) => element.name === "Persistence proof control" && (element.content.kind === "text" || element.content.kind === "text-window") && element.content.value === sentence,
    );
    if (!observed) throw new Error("persisted application state was not observable after container recreation");
    console.log(JSON.stringify({ persistence: "green", elementId: observed.id }));
  } else if (mode === "inventory") {
    const all = await elements();
    console.log(JSON.stringify(all.map((element) => ({ id: element.id, role: element.role, name: element.name, actions: element.actions.map((action) => action.name), states: element.states, operations: element.operations, contentKind: element.content?.kind, contentValue: element.content?.value, visibility: element.visibility, nativeRole: element.diagnostic?.nativeRole, nativeId: element.diagnostic?.nativeId }))));
  } else if (mode === "protected") {
    const all = await elements();
    const protectedElement = all.find((element) => element.content.kind === "redacted" && element.content.reason === "protected");
    if (!protectedElement) throw new Error("no platform-protected control produced structured redaction");
    if ("value" in protectedElement.content) throw new Error("protected content carried a value");
    console.log(JSON.stringify({ protected: "redacted", elementId: protectedElement.id, reason: protectedElement.content.reason }));
  } else {
    throw new Error(`unknown scenario mode: ${mode}`);
  }
} finally {
  client.close();
}

import { createHash } from "node:crypto";
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
    const editable = withinApplication(all, "kate").find(
      (element) =>
        element.role === "text" &&
        element.operations?.some((operation) => operation.operation === "setText" && operation.availability === "available") &&
        element.actions?.some((action) => action.name === "SetFocus" && action.availability === "available"),
    );
    if (!editable) throw new Error("observable content absent: plain Kate published no visible writable text control");
    const written = await client.setElementText({ id: editable.id, text: sentence });
    if (!written.element) throw new Error(written.refusal ?? "setElementText returned no element");
    const read = await client.readElementContent({ id: editable.id, offset: 0, limit: 4000 });
    if (read.content?.kind !== "text" || read.content.value !== sentence) throw new Error("read did not return the exact set_text value");
    const taskButton = all.find(
      (element) => element.role === "button" && element.name.includes("Kate") && element.actions?.some((action) => action.name === "Press"),
    );
    if (!taskButton) throw new Error("the desktop shell did not publish Kate's task button");
    const activated = await client.activateElement({ id: taskButton.id, action: "Press" });
    if (!activated.element) throw new Error(activated.refusal ?? "activateElement returned no element");
    const typed = await client.typeText({ id: editable.id, text: "Z" });
    if (!typed.element) throw new Error(typed.refusal ? JSON.stringify(typed.refusal) : "typeText returned no element");
    const chord = await client.sendKeyChord({ id: editable.id, chord: "Home" });
    if (!chord.element) throw new Error(chord.refusal ?? "sendKeyChord returned no element");
    const restored = await client.setElementText({ id: editable.id, text: sentence });
    if (!restored.element) throw new Error(restored.refusal ?? "final setElementText returned no element");
    console.log(JSON.stringify({ semantic: "green", elementId: editable.id, find: true, read: true, set_text: true, activate: true, type: true, key_chord: true }));
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
    // The half of the rule that costs something: another editable control in
    // THE SAME application, outside the watched document's subtree, is
    // mutated and must produce nothing. Without this the "subscription" is
    // just an application-wide firehose wearing an element's name.
    const outside = withinApplication(await elements(), "kate").find(
      (element) => element.role === "text" && element.id !== editable.id && element.operations.some((operation) => operation?.operation === "setText" && operation.availability === "available"),
    );
    if (!outside) throw new Error("no second editable control in the application to prove the subtree boundary with");
    const strays = [];
    const stopStrays = client.onChangeEvent((event) => {
      if (event.subscriptionId === watch.subscription.subscriptionId) strays.push(event);
    });
    await client.setElementText({ id: outside.id, text: `OUTSIDE THE WATCHED SUBTREE ${Date.now()}` });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    stopStrays();
    if (strays.length > 0) throw new Error(`a change outside the watched subtree produced ${strays.length} event(s)`);
    await client.unsubscribeElement({ subscriptionId: watch.subscription.subscriptionId });
    console.log(JSON.stringify({ subscription: "green", elementId: editable.id, outsideElementId: outside.id, outsideEvents: strays.length, events: heard.length, kinds: [...new Set(heard.map((event) => event.kind))], attribution: [...new Set(heard.map((event) => event.attribution))] }));
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
    const expected = process.env.MASTRA_CC_PROTECTED_VALUE;
    if (!expected) throw new Error("MASTRA_CC_PROTECTED_VALUE is required");
    const scoped = await client.queryElements({ role: "textbox", name: "Password", limit: 100 });
    if (scoped.refusal) throw new Error(JSON.stringify(scoped.refusal));
    const protectedElement = scoped.elements.find((element) => element.content.kind === "text");
    if (!protectedElement || protectedElement.content.kind !== "text") throw new Error("the Chromium password control was not readable through AT-SPI");
    const published = protectedElement.content.value;
    if (![...published].every((character) => ["•", "●", "*", "\u0000"].includes(character))) {
      throw new Error("the password control published content that was neither exact input nor a recognised platform mask");
    }
    if ([...published].length !== [...expected].length) throw new Error("the published password mask length did not match the field value length");
    const written = await client.setElementText({ id: protectedElement.id, text: expected });
    if (written.element || !written.refusal) {
      throw new Error(`a masked password write reported exact success instead of a truthful refusal: ${JSON.stringify(written)}`);
    }
    if (written.refusal.message.includes(expected) || written.refusal.message.includes(published)) {
      throw new Error("the password write refusal echoed protected content");
    }
    const after = await client.queryElements({ role: "textbox", name: "Password", limit: 100 });
    const fresh = after.elements.find((element) => element.id === protectedElement.id);
    if (fresh?.content.kind !== "text" || fresh.content.value !== published) throw new Error("the post-write observation did not remain the exact platform-published mask");
    const digest = createHash("sha256").update(published).digest("hex");
    console.log(JSON.stringify({ protected: `sha256:${digest}`, elementId: protectedElement.id, publishedLength: [...published].length, refusal: written.refusal.code, exactSuccess: false, matched: true }));
  } else {
    throw new Error(`unknown scenario mode: ${mode}`);
  }
} finally {
  client.close();
}

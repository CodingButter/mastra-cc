import { connect } from "/opt/mastra-cc/transport/index.mjs";

const socketPath = process.env.MASTRA_CC_SOCKET;
if (!socketPath) throw new Error("MASTRA_CC_SOCKET is required");
const mode = process.argv[2];
const sentence = process.env.MASTRA_CC_PROOF_SENTENCE;
const client = await connect({ socketPath });

async function elements() {
  return (await client.queryElements({ limit: 1000 })).elements;
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
    const editable = all.find(
      (element) => element.operations?.some((operation) => operation.operation === "setText" && operation.availability === "available") && element.content?.kind !== "redacted",
    );
    if (!editable) throw new Error("no editable ordinary control was observed");
    const written = await client.setElementText({ id: editable.id, text: sentence });
    if (!written.element) throw new Error(written.refusal ?? "setElementText returned no element");
    const fresh = (await elements()).find((element) => element.id === editable.id);
    if (!fresh) throw new Error("edited element was absent from fresh observation");
    if (fresh.content === undefined) throw new Error("observable content absent after successful write");
    if (!((fresh.content.kind === "text" || fresh.content.kind === "text-window") && fresh.content.value === sentence)) {
      throw new Error("observable content did not equal the exact sentence after re-query");
    }
    console.log(JSON.stringify({ semantic: "green", elementId: editable.id, sentence }));
  } else if (mode === "inventory") {
    const all = await elements();
    console.log(JSON.stringify(all.filter((element) => element.role === "text" || element.role === "textbox").map((element) => ({ id: element.id, role: element.role, name: element.name, contentKind: element.content.kind, nativeRole: element.diagnostic?.nativeRole, nativeId: element.diagnostic?.nativeId }))));
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

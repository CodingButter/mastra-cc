import { connect } from "/opt/mastra-cc/transport/dist/index.mjs";

const socketPath = process.env.MASTRA_CC_SOCKET;
if (!socketPath) throw new Error("MASTRA_CC_SOCKET is required");

const mode = process.argv[2];
const client = await connect({ socketPath });

try {
  if (mode === "observe") {
    const { elements } = await client.queryElements({ limit: 500 });
    const kate = elements.find((element) => element.role === "application" && element.name === "kate");
    if (!kate) throw new Error("Kate was not readable through the real accessibility bus");
    console.log(JSON.stringify({ application: kate.name, route: kate.diagnostics?.visibilityRoute }));
  } else if (mode === "refusal") {
    const known = (await client.openApplication({ name: "qt6ct" })).refusal;
    const unknown = (await client.openApplication({ name: "zz-no-such-app" })).refusal;
    if (!known || known !== unknown) throw new Error("known unpermitted and unknown applications did not refuse byte-identically");
    console.log(JSON.stringify({ refusal: known }));
  } else if (mode === "launch") {
    const result = await client.openApplication({ name: "qt6ct" });
    if (!result.refusal?.includes("was opened but did not become readable")) {
      throw new Error("spawned-but-unreadable application did not receive the bounded readiness refusal");
    }
    console.log(JSON.stringify({ refusal: result.refusal }));
  } else {
    throw new Error(`unknown portability-client mode: ${mode}`);
  }
} finally {
  client.close();
}

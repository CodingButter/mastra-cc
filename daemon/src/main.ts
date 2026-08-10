import { join } from "node:path";
import { SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import { registry } from "./backends/registry.js";
import { resolveOne } from "./backends/atspi/resolve.js";
import { startServer } from "./server.js";

// The daemon: one Node process, single-threaded (ADR-0030). --backend selects
// from the registry; this is a LOCAL OPERATOR FLAG on the daemon's own command
// line, not schema - B10 and ADR-0018 govern the wire, and no backend name
// ever crosses it. --capture <name> records every exchange the backend
// performs to daemon/fixtures/<name>/tape.json; --fixture <name> selects the
// tape the replay backend answers from. --query / --resolve are one-shot
// operator modes: ask the backend directly, print, exit - no socket.

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

// --verify-tape <name>: replay a tape against the live bus and report drift.
// A release-gate check (docs/proofs/README.md), not a CI step - CI has no bus.
const verifyFixture = arg("--verify-tape");
if (verifyFixture !== null) {
  const { verifyTape } = await import("./backends/replay/verify.js");
  await verifyTape(verifyFixture, (line) => console.log(line));
  process.exit(0);
}

const backendName = arg("--backend");
if (!backendName || !registry[backendName]) {
  console.error(
    `daemon: --backend is required and must be one of: ${Object.keys(registry).join(", ")} (got ${JSON.stringify(backendName)})`,
  );
  process.exit(2);
}

const capture = arg("--capture") ?? undefined;
const fixture = arg("--fixture") ?? undefined;
const backend = registry[backendName]({ capture, fixture });

const query = arg("--query");
const resolve = arg("--resolve");

if (query !== null || resolve !== null) {
  const name = (query ?? resolve) as string;
  const { elements } = await backend.queryElements({ name });
  let exitCode = 0;
  if (resolve !== null) {
    const resolution = resolveOne(elements, name);
    if ("element" in resolution) {
      const { role, name: elementName, id } = resolution.element;
      console.log(`element: role=${role} name=${JSON.stringify(elementName)} id=${id}`);
    } else {
      console.error(`daemon: ${resolution.refusal}`);
      exitCode = 1;
    }
  } else if (elements.length === 0) {
    console.error(`daemon: no element matched ${JSON.stringify(name)} - not found is not proof of absence; look again`);
    exitCode = 1;
  } else {
    for (const element of elements) {
      console.log(`element: role=${element.role} name=${JSON.stringify(element.name)} id=${element.id}`);
    }
  }
  await backend.close();
  process.exit(exitCode);
}

const socketPath =
  arg("--socket") ?? join(process.env.XDG_RUNTIME_DIR ?? "/tmp", "mastra-cc", "daemon.sock");

const server = await startServer({ socketPath, backend });
console.log(`daemon: listening on ${socketPath} (backend ${backend.name}, schema ${SCHEMA_DIGEST.slice(0, 12)}...)`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void backend.close().then(() => process.exit(0));
  });
}

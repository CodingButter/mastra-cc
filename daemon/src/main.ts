import { join } from "node:path";
import { captureRoute } from "./backends/atspi/kwin-capture.js";
import { SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import { openAuditLog, useAuditLog } from "./audit.js";
import { registry } from "./backends/registry.js";
import { desktopEntryDirectories } from "./inventory.js";
import { resolveOne } from "./backends/atspi/resolve.js";
import { selectAccessibilityLayer } from "./accessibility/select.js";
import { selectKeyDelivery } from "./rawinput/select.js";
import { composeCatalog, loadProfilesFile, MalformedProfilesFileError } from "./launch/profiles.js";
import { baseLaunchCatalog } from "./launch/derived.js";
import type { LaunchCatalog } from "./launch/recipes.js";
import { terminateOwned } from "./launch/spawn.js";
import { OwnershipTable } from "./launch/table.js";
import { startServer, startWebSocketServer } from "./server.js";
import { startAfterAccessibility } from './accessibility/startup.js';

// The daemon: one Node process, single-threaded (ADR-0030). --backend selects
// from the registry; this is a LOCAL OPERATOR FLAG on the daemon's own command
// line, not schema - B10 and ADR-0018 govern the wire, and no backend name
// ever crosses it. --capture <name> records every exchange the backend
// performs to daemon/fixtures/<name>/tape.json; --fixture <name> selects the
// tape the replay backend answers from. --query / --resolve are one-shot
// operator modes: ask the backend directly, print, exit - no socket.
// --profiles <file> names the daemon-local browser-profiles file (ADR-0038)
// whose entries become launch identities: one catalog recipe per named
// profile, each launching the browser against its own profile directory.

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function argAll(name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === name && process.argv[i + 1]) values.push(process.argv[i + 1]);
  }
  return values;
}

// --verify-tape <name>: replay a tape against the live bus and report drift.
// A release-gate check (docs/proofs/README.md), not a CI step - CI has no bus.
try {
  captureRoute();
} catch (error) {
  console.error(`daemon: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
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

// The operator's browser identities, composed into the catalog once at boot
// (ADR-0038). A malformed profiles file fails startup loudly, like grants.
// This runs BEFORE the name composition below, which needs the composed
// catalog to know what each identity appears as in the tree.
// The machine's own desktop entries are the base of the catalog (ADR-0062),
// derived ONCE here at boot and never on a request path. Three orderings are
// load-bearing:
//   - inside baseLaunchCatalog, CATALOG spreads LAST over the derived
//     entries, so a google-chrome
//     desktop entry can never displace the hand-written chrome/gmail recipes
//     and their profile directories (ADR-0038).
//   - composeCatalog runs after that, so browser profiles still clone the
//     built-in browser recipe exactly as they do today.
//   - the whole expression stays BEFORE the name composition below, which
//     needs the composed catalog to expand derived appearsAs names.
const catalog = (() => {
  try {
    const base: LaunchCatalog = baseLaunchCatalog(desktopEntryDirectories());
    const profiles =
      arg("--profiles") !== null ? loadProfilesFile(arg("--profiles") as string, base) : [];
    return composeCatalog(base, profiles);
  } catch (error) {
    if (error instanceof MalformedProfilesFileError) {
      console.error(`daemon: ${error.message}`);
      process.exit(2);
    }
    throw error;
  }
})();

// Consent-era authority flags are removed, not ignored. This is deliberately a
// denylist: all other existing operator flags retain their established parsing.
const removedFlags = ["--grants", "--grant", "--permit", "--allow", "--capabilities", "--acquire-accessibility"];
for (const flag of removedFlags) {
  if (process.argv.includes(flag)) {
    console.error(`daemon: ${flag} was removed in protocol 1.30.0; the agent-owned session has full desktop authority`);
    process.exit(2);
  }
}

const accessibility = selectAccessibilityLayer();
const keys = selectKeyDelivery();

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

// --audit <path>: where the access record is kept (ADR-0026). There is NO
// default path, and that is the decision: an audit log is a standing record of
// which elements a session touched, and a daemon nobody asked to keep one keeps
// none. The flag is read after the one-shot modes above, which serve no request
// and so record no access.
const auditPath = arg("--audit");
if (auditPath !== null) useAuditLog(openAuditLog(auditPath));

const table = new OwnershipTable();

// The daemon owns what it launched, including cleaning it up: on shutdown it
// SIGTERMs every process its table still owns - and never anything else
// (terminateOwned re-checks (pid, start-time) identity per entry via
// table.owns, so a recycled pid is never signalled; asserted in
// launch/__tests__/spawn-records.test.ts).
//
// The handlers are installed BEFORE the server binds its socket: the socket is
// what clients actually poll for readiness, so a handler installed after it
// would leave a window where a client can drive a launch and a signal still
// dies node's default death, orphaning the table. SIGHUP is in the list
// because it is how this daemon actually dies in the wild: a proof-leg shell
// or terminal closes, the background daemon gets HUP - which is issue #14's
// qt6ct orphans, reproduced live on 2026-08-20 (segment 4). The first signal
// runs cleanup; a second signal is an operator who has waited long enough,
// and it exits immediately - cleanup already ran, and a daemon that latched
// once and then ignored every further signal would be killable only by
// SIGKILL, the one path that orphans the table. terminateOwned itself is safe
// to reach twice: it re-checks (pid, start-time) identity per entry via
// table.owns and never signals a pid it no longer owns. SIGKILL and a crash
// still skip cleanup by definition; that residue is a named limitation, not a
// promise.
// --ws-port <n> / --ws-host <addr>: the second pipe (ADR-0058). ABSENT MEANS
// ABSENT - no flag, no listener, no port. The bind address defaults to
// loopback; widening it is always a visible act on a command line, which is
// what a container publishing a port has to do (--ws-host 0.0.0.0), because
// Docker's proxy cannot reach the container's own loopback. Port 0 lets the
// kernel choose and the daemon prints what it got.
const wsPortArg = arg("--ws-port");
const wsPort = wsPortArg === null ? null : Number(wsPortArg);
if (wsPort !== null && (!Number.isInteger(wsPort) || wsPort < 0 || wsPort > 65535)) {
  console.error(`daemon: --ws-port wants a port number, got ${JSON.stringify(wsPortArg)}`);
  process.exit(1);
}
const wsHost = arg("--ws-host") ?? "127.0.0.1";
// --ws-allow-origin <origin[,origin...]>: browser pages allowed to connect.
// Absent means none: a page on any website could otherwise drive this desktop.
const wsAllowedOrigins = new Set((arg("--ws-allow-origin") ?? "").split(",").map((o) => o.trim()).filter((o) => o !== ""));

let server: Awaited<ReturnType<typeof startServer>> | undefined;
let wsServer: Awaited<ReturnType<typeof startWebSocketServer>> | undefined;
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    if (shuttingDown) {
      // cleanup already ran; a backend.close() that hangs or rejects must
      // not leave a daemon only SIGKILL can end
      process.exit(1);
    }
    shuttingDown = true;
    terminateOwned(table);
    server?.close();
    wsServer?.close();
    backend.close().then(
      () => process.exit(0),
      () => process.exit(1)
    );
    // a backend whose close() never settles gets five seconds, then the
    // daemon exits anyway - the table is already reaped, and hanging here
    // recreates the unkillable daemon this handler exists to prevent
    setTimeout(() => process.exit(1), 5000).unref();
  });
}

try {
  await startAfterAccessibility({
    backend: backendName,
    mode: "serve",
    accessibility,
    start: async () => {
      server = await startServer({
        socketPath,
        backend,
        launch: { catalog, table, accessibility, keys },
      });
      server.on("close", () => terminateOwned(table));

      if (wsPort !== null) {
        wsServer = await startWebSocketServer({
          port: wsPort,
          host: wsHost,
          allowedOrigins: wsAllowedOrigins,
          backend,
          launch: { catalog, table, accessibility, keys },
        });
        // Belt and braces for a close that arrives without a signal. The signal path
        // does NOT rely on this: ws only fires "close" once every client has gone.
        wsServer.on("close", () => terminateOwned(table));
        console.log(`daemon: websocket listening on ${wsServer.host}:${wsServer.port}`);
      }
    },
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await backend.close();
  process.exit(1);
}

console.log(`daemon: listening on ${socketPath} (backend ${backend.name}, schema ${SCHEMA_DIGEST.slice(0, 12)}...)`);

import { join } from "node:path";
import { CAPABILITY_NAMES, SCHEMA_DIGEST, type CapabilityName } from "@mastra-cc/protocol-types";
import { registry } from "./backends/registry.js";
import { normalise } from "./backends/atspi/names.js";
import { resolveOne } from "./backends/atspi/resolve.js";
import { loadGrantsFile, MalformedGrantsFileError } from "./grants.js";
import {
  composeBootNames,
  composeCatalog,
  loadProfilesFile,
  MalformedProfilesFileError,
} from "./launch/profiles.js";
import { CATALOG } from "./launch/recipes.js";
import { terminateOwned } from "./launch/spawn.js";
import { OwnershipTable } from "./launch/table.js";
import { startServer } from "./server.js";

// The daemon: one Node process, single-threaded (ADR-0030). --backend selects
// from the registry; this is a LOCAL OPERATOR FLAG on the daemon's own command
// line, not schema - B10 and ADR-0018 govern the wire, and no backend name
// ever crosses it. --capture <name> records every exchange the backend
// performs to daemon/fixtures/<name>/tape.json; --fixture <name> selects the
// tape the replay backend answers from. --query / --resolve are one-shot
// operator modes: ask the backend directly, print, exit - no socket.
// --permit <name> (repeatable) is the SESSION-SCOPED authority for
// openApplication (ADR-0034): the permit set dies with this process.
// --grants <file> names the daemon-local permissions file (ADR-0036) whose
// "applications" entries are durable observe grants; --grant <name>
// (repeatable) is the session-scoped observe analog of --permit, for reading
// applications this daemon did not launch. The effective observe set is the
// union grants-file ∪ --grant ∪ --permit (a launch permit implies an observe
// grant for the launched name, or a permitted launch would be unreadable
// forever), composed ONCE here at boot and nowhere else.
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
const catalog = (() => {
  try {
    const profiles = arg("--profiles") !== null ? loadProfilesFile(arg("--profiles") as string) : [];
    return composeCatalog(CATALOG, profiles);
  } catch (error) {
    if (error instanceof MalformedProfilesFileError) {
      console.error(`daemon: ${error.message}`);
      process.exit(2);
    }
    throw error;
  }
})();

// The two name sets, composed once at boot and never recomputed (ADR-0036,
// ADR-0038): what may be LAUNCHED and what may be SEEN are different sets,
// and the composer - not this entry script - is where that split is tested.
// A malformed grants file fails startup loudly: the operator meant something,
// and the daemon must not silently run with "no grants" in its place.
const { launchPermits, visibility } = (() => {
  try {
    const file = arg("--grants") !== null ? loadGrantsFile(arg("--grants") as string) : new Set<string>();
    return composeBootNames({
      permits: new Set(argAll("--permit").map(normalise)),
      grants: file,
      flags: new Set(argAll("--grant").map(normalise)),
      catalog,
    });
  } catch (error) {
    if (error instanceof MalformedGrantsFileError) {
      console.error(`daemon: ${error.message}`);
      process.exit(2);
    }
    throw error;
  }
})();
// --allow <class>: session-scoped authority to PERFORM a class of effect on an
// element, the effect-side analog of --permit (ADR-0034 - it dies with this
// process). Composed once here, like every other name set. The class must be
// one the schema defines: an unknown one is an operator's typo, and a typo that
// silently grants nothing looks exactly like a daemon that is broken.
// Segment 3's per-application capability configuration attaches inside
// holdsEffectAuthority; this flag stays the session-wide answer.
const allows = new Set(argAll("--allow")) as Set<CapabilityName>;
for (const cls of allows) {
  if (!CAPABILITY_NAMES.includes(cls) || cls === "observe" || cls === "launch") {
    console.error(
      `daemon: --allow must name one of the element-effect classes: edit, activate, submit (got ${JSON.stringify(cls)})`,
    );
    process.exit(2);
  }
}

const backend = registry[backendName]({ capture, fixture, visibility });

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

const table = new OwnershipTable();

const server = await startServer({
  socketPath,
  backend,
  launch: { permits: launchPermits, allows, catalog, table },
  visibility,
});
console.log(`daemon: listening on ${socketPath} (backend ${backend.name}, schema ${SCHEMA_DIGEST.slice(0, 12)}...)`);

// The daemon owns what it launched, including cleaning it up: on shutdown it
// SIGTERMs every process its table still owns - and never anything else
// (terminateOwned re-checks liveness per entry; asserted in
// launch/__tests__/spawn-records.test.ts).
server.on("close", () => terminateOwned(table));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    terminateOwned(table);
    server.close();
    void backend.close().then(() => process.exit(0));
  });
}

import { mkdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { dirname } from "node:path";
import {
  SCHEMA_DIGEST,
  PROTOCOL_VERSION,
  type OpenApplicationResult,
  type SemanticElement,
} from "@mastra-cc/protocol-types";
import type { Backend } from "./backend.js";
import { normalise } from "./backends/atspi/names.js";
import { CATALOG, type LaunchCatalog } from "./launch/recipes.js";
import { launchApplication } from "./launch/spawn.js";
import { OwnershipTable } from "./launch/table.js";

// The daemon's socket server: newline-delimited JSON, digest handshake first,
// then requests dispatched through the effect-class gate. Accessibility access
// is serialised regardless of what Phase 6 measures - serialising is what
// makes an audit record attributable (docs/07-ROADMAP.md:92), and that reason
// is independent of whether concurrency is safe.

// Everything the launch path needs beyond the backend. The permit set is the
// AUTHORITY half (session-scoped, from --permit); the catalog is the
// CAPABILITY half (ADR-0019: different questions, different parties). The
// default context carries no permits, so a server started without them
// refuses every launch.
export interface LaunchContext {
  permits: ReadonlySet<string>;
  catalog: LaunchCatalog;
  table: OwnershipTable;
  /** bounded poll for the launched application to appear in the tree */
  pollBudgetMs?: number;
  pollIntervalMs?: number;
}

const NO_PERMITS: LaunchContext = { permits: new Set(), catalog: CATALOG, table: new OwnershipTable() };

// ONE constant for both the unknown name and the unpermitted name. The
// byte-equality IS the security property (ADR-0008 rule 6): a refusal must
// never reveal whether an application is installed on this machine.
export const UNAVAILABLE_REFUSAL = "no application by that name is available to this session";

export const ALREADY_RUNNING_REFUSAL =
  "that application is already running and was not opened by this daemon - launching a second copy is refused; the running copy must be closed first";

// The dispatch table names every method the daemon serves, its effect class,
// and WHEN its enforcement runs. B11 (tools/pins/b11.mjs, wired in this same
// commit) reads this table from source and asserts every non-observe entry is
// marked "before-call" - result-time enforcement is legitimate only for
// observe, because filtering a response does not unsend the email. The
// enforcement TIMING itself is pinned by the ordering test in
// __tests__/launch-authority.test.ts; the pin and the test together are B11.
type Handler = (params: unknown, backend: Backend, launch: LaunchContext) => Promise<unknown>;
const DISPATCH: Record<string, { effectClass: string; enforcement: string; handler: Handler }> = {
  queryElements: { effectClass: "observe", enforcement: "at-result", handler: (p, b) => b.queryElements((p ?? {}) as never) },
  attestElement: { effectClass: "observe", enforcement: "at-result", handler: (p, b) => b.attestElement((p ?? {}) as never) },
  openApplication: { effectClass: "activate", enforcement: "before-call", handler: (p, b, l) => openApplication((p ?? {}) as { name?: string }, b, l) },
};

const POLL_BUDGET_MS = 10_000; // how long a launched app gets to become readable
const POLL_INTERVAL_MS = 250;

async function findApplication(backend: Backend, name: string): Promise<SemanticElement | undefined> {
  const { elements } = await backend.queryElements({ role: "application", name });
  return elements.find((el) => el.role === "application" && normalise(el.name) === normalise(name));
}

// The launch handler. Order is the contract (ADR-0019): AUTHORITY first -
// the permit set is consulted before the catalog, the tree, or anything else,
// and an unpermitted name never reaches a capability probe, because the probe
// itself would leak that the application exists. Runs inside the serialised
// chain like every other operation.
async function openApplication(
  params: { name?: string },
  backend: Backend,
  launch: LaunchContext,
): Promise<OpenApplicationResult> {
  const name = typeof params.name === "string" ? params.name : "";
  if (!launch.permits.has(normalise(name))) {
    return { refusal: UNAVAILABLE_REFUSAL };
  }
  const budget = launch.pollBudgetMs ?? POLL_BUDGET_MS;
  const interval = launch.pollIntervalMs ?? POLL_INTERVAL_MS;
  // Idempotent re-open: a live entry of ours wins - no second spawn, no
  // refusal, even when a foreign same-name copy is also running (the by-name
  // tree match cannot distinguish the two copies per element at this
  // segment's name-only granularity; M2.4's pid join will).
  if (launch.table.ownsName(name) === undefined) {
    const running = await findApplication(backend, name);
    if (running !== undefined) {
      // Running, and not ours: refuse, never kill (ADR-0027 - the asking
      // surface arrives with a later milestone).
      return { refusal: ALREADY_RUNNING_REFUSAL };
    }
    try {
      await launchApplication(name, launch.catalog, launch.table);
    } catch (error) {
      return { refusal: (error as Error).message };
    }
  }
  const deadline = Date.now() + budget;
  for (;;) {
    const application = await findApplication(backend, name);
    if (application !== undefined) return { application };
    if (Date.now() >= deadline) {
      return {
        refusal: `the application was opened but did not become readable within ${budget}ms - refusing to pretend it is ready`,
      };
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

interface Request {
  type: "request";
  id: number;
  method: string;
  params?: unknown;
}

export interface HandledResponse {
  type: "response";
  id: number;
  result?: unknown;
  refusal?: string;
}

// Serialise every backend call: one at a time, in arrival order.
let chain: Promise<unknown> = Promise.resolve();
function serialised<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

export async function handleRequest(
  request: Request,
  backend: Backend,
  launch: LaunchContext = NO_PERMITS,
): Promise<HandledResponse> {
  const entry = DISPATCH[request.method];
  if (!entry) {
    return {
      type: "response",
      id: request.id,
      refusal:
        `refused by the effect-class gate: "${request.method}" is not a method of ` +
        `schema v${PROTOCOL_VERSION} - the daemon serves what the schema defines and nothing else`,
    };
  }
  // A non-observe entry without before-call enforcement is unrepresentable in
  // the table above (B11 reads the source to keep it that way); this check is
  // the runtime backstop with the same refusal shape.
  if (entry.effectClass !== "observe" && entry.enforcement !== "before-call") {
    return {
      type: "response",
      id: request.id,
      refusal: `refused by the effect-class gate: "${request.method}" is ${entry.effectClass}-class but not marked for before-call enforcement`,
    };
  }
  try {
    const result = await serialised<unknown>(() => entry.handler(request.params, backend, launch));
    return { type: "response", id: request.id, result };
  } catch (error) {
    return { type: "response", id: request.id, refusal: `backend "${backend.name}" failed: ${(error as Error).message}` };
  }
}

export function startServer(options: {
  socketPath: string;
  backend: Backend;
  launch?: LaunchContext;
}): Promise<Server> {
  const { socketPath, backend, launch } = options;
  mkdirSync(dirname(socketPath), { recursive: true });
  rmSync(socketPath, { force: true });

  const server = createServer((socket) => {
    let buffer = "";
    let helloDone = false;
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.trim()) continue;
        let message: { type: string; digest?: string; id?: number; method?: string; params?: unknown };
        try {
          message = JSON.parse(line);
        } catch {
          socket.write(`${JSON.stringify({ type: "refusal", refusal: "daemon: not a JSON line" })}\n`);
          continue;
        }
        if (!helloDone) {
          if (message.type !== "hello" || typeof message.digest !== "string") {
            socket.write(`${JSON.stringify({ type: "refusal", refusal: "daemon: hello with a schema digest must come first" })}\n`);
            socket.end();
            return;
          }
          if (message.digest !== SCHEMA_DIGEST) {
            socket.write(
              `${JSON.stringify({
                type: "refusal",
                refusal:
                  `daemon: refused at connect - this daemon speaks schema digest ${SCHEMA_DIGEST} ` +
                  `but the transport was built against schema digest ${message.digest} (digest-agreement check)`,
              })}\n`,
            );
            socket.end();
            return;
          }
          helloDone = true;
          socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST, version: PROTOCOL_VERSION })}\n`);
          continue;
        }
        if (message.type === "request" && typeof message.id === "number" && typeof message.method === "string") {
          void handleRequest(message as Request, backend, launch).then((response) => {
            if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
          });
        } else {
          // Valid JSON that is not a well-formed request gets a named refusal,
          // never silence - a swallowed line leaves the client's promise
          // pending forever, which is a hang, not a refusal.
          socket.write(
            `${JSON.stringify({
              type: "refusal",
              refusal: 'daemon: a message after hello must be {type:"request", id:number, method:string} - refusing a malformed line',
            })}\n`,
          );
        }
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve(server));
  });
}

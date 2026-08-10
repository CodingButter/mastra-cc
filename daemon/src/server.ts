import { mkdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { dirname } from "node:path";
import { SCHEMA_DIGEST, PROTOCOL_VERSION } from "@mastra-cc/protocol-types";
import type { Backend } from "./backend.js";

// The daemon's socket server: newline-delimited JSON, digest handshake first,
// then requests dispatched through the effect-class gate. Accessibility access
// is serialised regardless of what Phase 6 measures - serialising is what
// makes an audit record attributable (docs/07-ROADMAP.md:92), and that reason
// is independent of whether concurrency is safe.

// The dispatch table names every method the daemon serves and its effect
// class. This table is B11's future subject: when the first non-observe
// operation arrives (M2), B11 must be wired in the same commit.
const DISPATCH: Record<string, { effectClass: "observe" }> = {
  queryElements: { effectClass: "observe" },
  attestElement: { effectClass: "observe" },
};

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

export async function handleRequest(request: Request, backend: Backend): Promise<HandledResponse> {
  const entry = DISPATCH[request.method];
  if (!entry) {
    return {
      type: "response",
      id: request.id,
      refusal:
        `refused by the effect-class gate: "${request.method}" is not an observe-class method of ` +
        `schema v${PROTOCOL_VERSION}; M1 serves observe only, and nothing beyond observe exists to grant`,
    };
  }
  // entry.effectClass is "observe" by construction today; the explicit check
  // stays so the refusal path exists before the first non-observe method does.
  if (entry.effectClass !== "observe") {
    return {
      type: "response",
      id: request.id,
      refusal: `refused by the effect-class gate: "${request.method}" is ${entry.effectClass}-class and M1 serves observe only`,
    };
  }
  try {
    const result = await serialised<unknown>(() =>
      request.method === "queryElements"
        ? backend.queryElements((request.params ?? {}) as never)
        : backend.attestElement((request.params ?? {}) as never),
    );
    return { type: "response", id: request.id, result };
  } catch (error) {
    return { type: "response", id: request.id, refusal: `backend "${backend.name}" failed: ${(error as Error).message}` };
  }
}

export function startServer(options: { socketPath: string; backend: Backend }): Promise<Server> {
  const { socketPath, backend } = options;
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
          void handleRequest(message as Request, backend).then((response) => {
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

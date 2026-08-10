import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import {
  SCHEMA_DIGEST,
  type AttestElementParams,
  type AttestElementResult,
  type QueryElementsParams,
  type QueryElementsResult,
} from "@mastra-cc/protocol-types";

// The one and only daemon client (B5, ADR-0003). Newline-delimited JSON over a
// unix domain socket. The connection is keyed on the schema digest: both sides
// state the digest they were built against before anything else, and a
// mismatch is refused AT CONNECT with a message naming both digests - never
// left to fail on a malformed field later.

export function defaultSocketPath(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR ?? "/tmp";
  return join(runtimeDir, "mastra-cc", "daemon.sock");
}

interface Hello {
  type: "hello";
  digest: string;
  version?: string;
}

interface Response {
  type: "response";
  id: number;
  result?: unknown;
  refusal?: string;
}

export interface TransportClient {
  queryElements(params: QueryElementsParams): Promise<QueryElementsResult>;
  attestElement(params: AttestElementParams): Promise<AttestElementResult>;
  close(): void;
}

export async function connect(options: { socketPath?: string } = {}): Promise<TransportClient> {
  const socketPath = options.socketPath ?? defaultSocketPath();
  const socket = createConnection(socketPath);
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let nextId = 1;
  let buffer = "";
  let helloResolve: ((h: Hello) => void) | null = null;
  let helloReject: ((e: Error) => void) | null = null;

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line.trim()) continue;
      let message: Hello | Response | { type: "refusal"; refusal: string };
      try {
        message = JSON.parse(line);
      } catch {
        // A peer that emits a non-JSON line is not the daemon this client was
        // built for. Refuse loudly and stop, mirroring the daemon's own
        // handling of the same case - never die in an event handler.
        failAll(new Error(`transport: peer at ${socketPath} sent a non-JSON line - refusing to continue`));
        socket.destroy();
        return;
      }
      if (message.type === "hello" && helloResolve) {
        helloResolve(message);
        helloResolve = null;
      } else if (message.type === "refusal") {
        const error = new Error(message.refusal);
        if (helloReject) {
          helloReject(error);
          helloReject = null;
        }
        for (const p of pending.values()) p.reject(error);
        pending.clear();
      } else if (message.type === "response") {
        const p = pending.get(message.id);
        if (p) {
          pending.delete(message.id);
          if (message.refusal !== undefined) p.reject(new Error(message.refusal));
          else p.resolve(message.result);
        }
      }
    }
  });

  const failAll = (error: Error) => {
    if (helloReject) {
      helloReject(error);
      helloReject = null;
    }
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  };
  socket.on("error", failAll);
  socket.on("close", () => failAll(new Error(`transport: connection to ${socketPath} closed`)));

  const serverHello = await new Promise<Hello>((resolve, reject) => {
    helloResolve = resolve;
    helloReject = reject;
    socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
  });

  if (serverHello.digest !== SCHEMA_DIGEST) {
    const refusal =
      `transport: refused at connect - this transport was built against schema digest ${SCHEMA_DIGEST} ` +
      `but the daemon speaks schema digest ${serverHello.digest} (digest-agreement check)`;
    socket.destroy();
    throw new Error(refusal);
  }

  function call(method: string, params: unknown): Promise<unknown> {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.write(`${JSON.stringify({ type: "request", id, method, params })}\n`);
    });
  }

  return {
    queryElements: (params) => call("queryElements", params) as Promise<QueryElementsResult>,
    attestElement: (params) => call("attestElement", params) as Promise<AttestElementResult>,
    close: () => void (socket as Socket).end(),
  };
}

import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import {
  SCHEMA_DIGEST,
  type ActivateElementParams,
  type ActivateElementResult,
  type AttestElementParams,
  type AttestElementResult,
  type ChangeEvent,
  type EditElementParams,
  type EditElementResult,
  type ListApplicationsParams,
  type ListApplicationsResult,
  type OpenApplicationParams,
  type OpenApplicationResult,
  type QueryElementsParams,
  type QueryElementsResult,
  type ReadElementContentParams,
  type ReadElementContentResult,
  type RevealElementParams,
  type RevealElementResult,
  type SetElementCaretParams,
  type SetElementCaretResult,
  type SetElementTextParams,
  type SetElementTextResult,
  type SetElementValueParams,
  type SetElementValueResult,
  type SubmitElementParams,
  type SubmitElementResult,
  type SubscribeElementParams,
  type SubscribeElementResult,
  type UnsubscribeElementParams,
  type UnsubscribeElementResult,
} from "@mastra-cc/protocol-types";

// The one and only daemon client (B5, ADR-0003). Newline-delimited JSON over a
// unix domain socket. The connection is keyed on the schema digest: both sides
// state the digest they were built against before anything else, and a
// mismatch is refused AT CONNECT with a message naming both digests - never
// left to fail on a malformed field later.
//
// Every method the daemon serves has a binding here, and every binding is the
// same line: name the method, hand the params over, name the result type. That
// sameness is the point. This package owns framing, correlation, address
// resolution, discovery and generated bindings, and nothing else (ADR-0003) -
// so there is no retry here, no convenience wrapper that fills in a parameter
// the caller did not give, and no method that means something slightly
// different from the one the daemon answers. A binding that did any of those
// would be a second implementation of the protocol, and the digest handshake
// above cannot detect a disagreement it is not told about.
//
// For most of this daemon's life the five observe-and-launch methods were bound
// and the eight that act were not. The daemon's headline claim is that it acts;
// until now, no independent client could ask it to.

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

// The daemon's one server-initiated message (ADR-0039). It carries no `id`
// because it answers nothing, which is exactly how the read loop below tells
// it apart from a reply.
interface EventMessage {
  type: "event";
  event: ChangeEvent;
}

export interface TransportClient {
  queryElements(params: QueryElementsParams): Promise<QueryElementsResult>;
  attestElement(params: AttestElementParams): Promise<AttestElementResult>;
  readElementContent(params: ReadElementContentParams): Promise<ReadElementContentResult>;
  subscribeElement(params: SubscribeElementParams): Promise<SubscribeElementResult>;
  unsubscribeElement(params: UnsubscribeElementParams): Promise<UnsubscribeElementResult>;
  openApplication(params: OpenApplicationParams): Promise<OpenApplicationResult>;
  editElement(params: EditElementParams): Promise<EditElementResult>;
  activateElement(params: ActivateElementParams): Promise<ActivateElementResult>;
  submitElement(params: SubmitElementParams): Promise<SubmitElementResult>;
  setElementValue(params: SetElementValueParams): Promise<SetElementValueResult>;
  setElementText(params: SetElementTextParams): Promise<SetElementTextResult>;
  setElementCaret(params: SetElementCaretParams): Promise<SetElementCaretResult>;
  revealElement(params: RevealElementParams): Promise<RevealElementResult>;
  listApplications(params?: ListApplicationsParams): Promise<ListApplicationsResult>;
  /**
   * Register a listener for pushed change events. Returns a function that
   * removes it. Events are delivered as they arrive and are never buffered:
   * a listener registered after an event has been and gone does not receive
   * it, because a change stream that replays history is a different product
   * from one that reports the present.
   */
  onChangeEvent(listener: (event: ChangeEvent) => void): () => void;
  close(): void;
}

/**
 * The daemon can be reached two ways: a unix socket on this filesystem, or a
 * websocket URL when it is somewhere else. The framing, handshake, digest
 * check and close semantics below are written once against this interface, so
 * the two dials cannot drift apart.
 */
interface Wire {
  /** How the peer is named in errors - a path or a URL. */
  readonly peer: string;
  write(line: string): void;
  /** The hard drop: socket.destroy()'s equivalent. */
  drop(): void;
  /** The polite close, what TransportClient.close() performs. */
  end(): void;
  onData(handler: (chunk: string) => void): void;
  onError(handler: (error: Error) => void): void;
  onClose(handler: () => void): void;
}

function socketWire(socketPath: string): Wire {
  const socket = createConnection(socketPath);
  return {
    peer: socketPath,
    write: (line) => void socket.write(line),
    drop: () => void socket.destroy(),
    end: () => void (socket as Socket).end(),
    onData: (handler) => void socket.on("data", (chunk) => handler(chunk.toString("utf8"))),
    onError: (handler) => void socket.on("error", handler),
    onClose: (handler) => void socket.on("close", handler),
  };
}

/**
 * Node's global WebSocket, not the `ws` library - the transport takes no new
 * dependency for a second way to dial. Precedent: daemon/src/backends/cdp.
 */
async function websocketWire(url: string): Promise<Wire> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error(`transport: could not open a websocket to ${url}`)), {
      once: true,
    });
  });
  return {
    peer: url,
    write: (line) => void ws.send(line),
    drop: () => void ws.close(),
    end: () => void ws.close(),
    onData: (handler) =>
      void ws.addEventListener("message", (event) => {
        const data = (event as MessageEvent).data;
        handler(typeof data === "string" ? data : Buffer.from(data as ArrayBuffer).toString("utf8"));
      }),
    onError: (handler) =>
      void ws.addEventListener("error", () => handler(new Error(`transport: websocket to ${url} failed`))),
    onClose: (handler) => void ws.addEventListener("close", () => handler()),
  };
}

export async function connect(options: { socketPath?: string; url?: string } = {}): Promise<TransportClient> {
  if (options.socketPath !== undefined && options.url !== undefined) {
    throw new Error(
      "transport: refused at connect - a socket path and a websocket URL were both given; " +
        "one connection has one address, so say which one",
    );
  }
  const wire =
    options.url !== undefined ? await websocketWire(options.url) : socketWire(options.socketPath ?? defaultSocketPath());
  const peer = wire.peer;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const listeners = new Set<(event: ChangeEvent) => void>();
  let nextId = 1;
  let buffer = "";
  let helloResolve: ((h: Hello) => void) | null = null;
  let helloReject: ((e: Error) => void) | null = null;

  wire.onData((chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line.trim()) continue;
      let message: Hello | Response | EventMessage | { type: "refusal"; refusal: string };
      try {
        message = JSON.parse(line);
      } catch {
        // A peer that emits a non-JSON line is not the daemon this client was
        // built for. Refuse loudly and stop, mirroring the daemon's own
        // handling of the same case - never die in an event handler.
        failAll(new Error(`transport: peer at ${peer} sent a non-JSON line - refusing to continue`));
        wire.drop();
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
      } else if (message.type === "event") {
        // An event answers no request, so it never touches the pending table.
        // It is handed to every listener even if none of them asked for this
        // subscription: the client is the one that knows whether it still
        // cares, and a transport that silently drops protocol traffic is a
        // transport that hides the daemon from its own client. A throwing
        // listener must not take the read loop - or the other listeners - down
        // with it.
        for (const listener of listeners) {
          try {
            listener(message.event);
          } catch {
            // a listener's failure is the listener's problem
          }
        }
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
  wire.onError(failAll);
  wire.onClose(() => failAll(new Error(`transport: connection to ${peer} closed`)));

  const serverHello = await new Promise<Hello>((resolve, reject) => {
    helloResolve = resolve;
    helloReject = reject;
    wire.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
  });

  if (serverHello.digest !== SCHEMA_DIGEST) {
    const refusal =
      `transport: refused at connect - this transport was built against schema digest ${SCHEMA_DIGEST} ` +
      `but the daemon speaks schema digest ${serverHello.digest} (digest-agreement check)`;
    wire.drop();
    throw new Error(refusal);
  }

  function call(method: string, params: unknown): Promise<unknown> {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      wire.write(`${JSON.stringify({ type: "request", id, method, params })}\n`);
    });
  }

  return {
    queryElements: (params) => call("queryElements", params) as Promise<QueryElementsResult>,
    attestElement: (params) => call("attestElement", params) as Promise<AttestElementResult>,
    readElementContent: (params) => call("readElementContent", params) as Promise<ReadElementContentResult>,
    subscribeElement: (params) => call("subscribeElement", params) as Promise<SubscribeElementResult>,
    unsubscribeElement: (params) => call("unsubscribeElement", params) as Promise<UnsubscribeElementResult>,
    openApplication: (params) => call("openApplication", params) as Promise<OpenApplicationResult>,
    editElement: (params) => call("editElement", params) as Promise<EditElementResult>,
    activateElement: (params) => call("activateElement", params) as Promise<ActivateElementResult>,
    submitElement: (params) => call("submitElement", params) as Promise<SubmitElementResult>,
    setElementValue: (params) => call("setElementValue", params) as Promise<SetElementValueResult>,
    setElementText: (params) => call("setElementText", params) as Promise<SetElementTextResult>,
    setElementCaret: (params) => call("setElementCaret", params) as Promise<SetElementCaretResult>,
    revealElement: (params) => call("revealElement", params) as Promise<RevealElementResult>,
    listApplications: (params) => call("listApplications", params ?? {}) as Promise<ListApplicationsResult>,
    onChangeEvent: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close: () => wire.end(),
  };
}


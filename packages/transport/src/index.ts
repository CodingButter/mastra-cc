import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import WebSocket from "ws";

/** An unterminated line longer than this ends the connection. Captures arrive as base64 PNG, so the bound is generous. */
export const MAX_LINE_CHARS = 64 * 1024 * 1024;
import {
  SCHEMA_DIGEST,
  type ActivateElementParams,
  type ActivateElementResult,
  type AttestElementParams,
  type AttestElementResult,
  type ChangeEvent,
  type EditElementParams,
  type EditElementResult,
  type AcquireAccessibilityParams,
  type AcquireAccessibilityResult,
  type DescribeAccessibilityParams,
  type DescribeDesktopParams,
  type DescribeAccessibilityResult,
  type DescribeDesktopResult,
  type CaptureElementParams,
  type CaptureElementResult,
  type DiscoverElementsParams,
  type DiscoverElementsResult,
  type ListApplicationsParams,
  type ListApplicationsResult,
  type OpenApplicationParams,
  type OpenApplicationResult,
  type RestartApplicationParams,
  type RestartApplicationResult,
  type SendKeyChordParams,
  type SendKeyChordResult,
  type TypeTextParams,
  type TypeTextResult,
  type ClearElementTextParams,
  type ClearElementTextResult,
  type ClickElementParams,
  type ClickElementResult,
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

export class TransportConnectionError extends Error {
  readonly code = "MASTRA_CC_TRANSPORT_TERMINAL";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TransportConnectionError";
  }
}

/**
 * A request that was sent and never answered inside the caller's budget.
 *
 * This is NOT a failure report. The line is open, the daemon never said no,
 * and an effect request that reached it may well have been performed - so the
 * only honest thing this can say is that the outcome is unknown. `performed`
 * is undefined for exactly that reason: it is the question, not the answer.
 *
 * A caller that receives this must observe the desk before acting again, and
 * must not resend: a resend is the duplicate keystroke CC-02 exists to prevent.
 */
export class UnansweredRequestError extends Error {
  readonly code = "MASTRA_CC_UNANSWERED";
  readonly method: string;
  readonly waitedMs: number;

  constructor(method: string, waitedMs: number) {
    super(
      `transport: ${method} was sent and not answered within ${waitedMs}ms - the connection is still open and the daemon has ` +
        "not refused, so whether it was performed is UNKNOWN. Look at the desk before acting again, and do not resend: " +
        "a resend of an effect that did land is a second effect",
    );
    this.name = "UnansweredRequestError";
    this.method = method;
    this.waitedMs = waitedMs;
  }
}

export function isUnansweredRequestError(value: unknown): value is UnansweredRequestError {
  return value instanceof UnansweredRequestError;
}

export function isTransportConnectionError(value: unknown): value is TransportConnectionError {
  return value instanceof TransportConnectionError;
}

function connectionError(error: Error): TransportConnectionError {
  return isTransportConnectionError(error) ? error : new TransportConnectionError(error.message, { cause: error });
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
  discoverElements(params: DiscoverElementsParams): Promise<DiscoverElementsResult>;
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
  describeAccessibility(params?: DescribeAccessibilityParams): Promise<DescribeAccessibilityResult>;
  describeDesktop(params?: DescribeDesktopParams): Promise<DescribeDesktopResult>;
  acquireAccessibility(params?: AcquireAccessibilityParams): Promise<AcquireAccessibilityResult>;
  restartApplication(params: RestartApplicationParams): Promise<RestartApplicationResult>;
  sendKeyChord(params: SendKeyChordParams): Promise<SendKeyChordResult>;
  typeText(params: TypeTextParams): Promise<TypeTextResult>;
  clearElementText(params: ClearElementTextParams): Promise<ClearElementTextResult>;
  clickElement(params: ClickElementParams): Promise<ClickElementResult>;
  captureElement(params: CaptureElementParams): Promise<CaptureElementResult>;
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
  /** Hard startup teardown; false preserves the established WebSocket close handshake. */
  drop(hard: boolean): void;
  /** The polite close, what TransportClient.close() performs. */
  end(): void;
  onOpen(handler: () => void): void;
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
    onOpen: (handler) => void socket.once("connect", handler),
    onData: (handler) => {
      const decoder = new StringDecoder("utf8");
      socket.on("data", (chunk) => handler(decoder.write(chunk)));
    },
    onError: (handler) => void socket.on("error", handler),
    onClose: (handler) => void socket.on("close", handler),
  };
}

function websocketWire(url: string): Wire {
  const ws = new WebSocket(url);
  return {
    peer: url,
    write: (line) => void ws.send(line),
    drop: (hard) => void (hard ? ws.terminate() : ws.close()),
    end: () => void ws.close(),
    onOpen: (handler) => void ws.addEventListener("open", handler, { once: true }),
    onData: (handler) => {
      const decoder = new StringDecoder("utf8");
      ws.addEventListener("message", (event) => {
        const data = event.data;
        if (typeof data === "string") handler(data);
        else if (Array.isArray(data)) handler(decoder.write(Buffer.concat(data)));
        else if (data instanceof ArrayBuffer) handler(decoder.write(Buffer.from(data)));
        else handler(decoder.write(data));
      });
    },
    onError: (handler) =>
      void ws.addEventListener("error", () => handler(new Error(`transport: websocket to ${url} failed`))),
    onClose: (handler) => void ws.addEventListener("close", () => handler()),
  };
}

export async function connect(
  options: { socketPath?: string; url?: string; replyBudgetMs?: number } = {},
): Promise<TransportClient> {
  const deadline = performance.now() + 10_000;
  if (options.socketPath !== undefined && options.url !== undefined) {
    throw new Error(
      "transport: refused at connect - a socket path and a websocket URL were both given; " +
        "one connection has one address, so say which one",
    );
  }
  let wire: Wire;
  try {
    wire =
      options.url !== undefined
        ? websocketWire(options.url)
        : socketWire(options.socketPath ?? defaultSocketPath());
  } catch (error) {
    throw connectionError(error instanceof Error ? error : new Error(String(error)));
  }
  const peer = wire.peer;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const listeners = new Set<(event: ChangeEvent) => void>();
  let nextId = 1;
  let buffer = "";
  let helloResolve: ((h: Hello) => void) | null = null;
  let helloReject: ((e: Error) => void) | null = null;
  let terminalError: TransportConnectionError | null = null;
  let starting = true;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;

  const terminate = (error: Error): TransportConnectionError => {
    if (terminalError) return terminalError;
    terminalError = connectionError(error);
    helloResolve = null;
    if (helloReject) {
      helloReject(terminalError);
      helloReject = null;
    }
    for (const p of pending.values()) p.reject(terminalError);
    pending.clear();
    clearTimeout(startupTimer);
    if (starting) wire.drop(true);
    return terminalError;
  };

  wire.onData((chunk) => {
    if (starting && terminalError) return;
    // Search only the new text: re-scanning the whole buffer per chunk is quadratic in a long line.
    const searchFrom = buffer.length;
    buffer += chunk;
    if (buffer.length > MAX_LINE_CHARS && buffer.lastIndexOf("\n") < buffer.length - MAX_LINE_CHARS) {
      buffer = "";
      terminate(new Error(`transport: peer at ${peer} sent a line longer than ${MAX_LINE_CHARS} characters without a newline - refusing to continue`));
      wire.drop(true);
      return;
    }
    let newline = buffer.indexOf("\n", searchFrom);
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
        terminate(new Error(`transport: peer at ${peer} sent a non-JSON line - refusing to continue`));
        wire.drop(starting);
        return;
      }
      if (message.type === "hello" && helloResolve) {
        helloResolve(message);
        helloResolve = null;
      } else if (message.type === "refusal") {
        terminate(new Error(message.refusal));
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

  wire.onError((error) => terminate(error));
  wire.onClose(() => terminate(new Error(`transport: connection to ${peer} closed`)));

  const serverHello = await new Promise<Hello>((resolve, reject) => {
    helloResolve = resolve;
    helloReject = reject;
    startupTimer = setTimeout(() => {
      terminate(new Error(`transport: startup at ${peer} timed out after 10000ms`));
    }, Math.max(0, deadline - performance.now()));
    wire.onOpen(() => {
      if (terminalError) return;
      try {
        wire.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
      } catch (error) {
        terminate(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });

  if (terminalError) throw terminalError;
  if (performance.now() >= deadline) {
    throw terminate(new Error(`transport: startup at ${peer} timed out after 10000ms`));
  }
  if (serverHello.digest !== SCHEMA_DIGEST) {
    const refusal =
      `transport: refused at connect - this transport was built against schema digest ${SCHEMA_DIGEST} ` +
      `but the daemon speaks schema digest ${serverHello.digest} (digest-agreement check)`;
    throw terminate(new Error(refusal));
  }
  starting = false;
  clearTimeout(startupTimer);
  helloReject = null;

  function call(method: string, params: unknown): Promise<unknown> {
    if (terminalError) return Promise.reject(terminalError);
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      // The budget is the CALLER's, and there is no default: a desk operation
      // has no length this transport knows. Launching an application, typing a
      // paragraph and waiting on a modal dialog are all legitimately slow, and
      // a default budget would turn "slow" into "unknown" on a desk that was
      // working perfectly. Unbounded waiting stays the contract for a caller
      // who does not choose otherwise; a caller who cannot afford to wait
      // forever says how long, and is told the outcome is unknown rather than
      // that the request failed (ADR-0109).
      const budget = options.replyBudgetMs;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (finish: () => void) => {
        clearTimeout(timer);
        finish();
      };
      const entry = {
        resolve: (value: unknown) => settle(() => resolve(value)),
        reject: (error: Error) => settle(() => reject(error)),
      };
      if (budget !== undefined) {
        timer = setTimeout(() => {
          // The connection is NOT terminated: the line is fine, and the other
          // requests on it have their own budgets. Only this one stops waiting.
          // Its id is dropped, so a late answer is discarded rather than
          // resolving a promise the caller already gave up on.
          if (pending.delete(id)) reject(new UnansweredRequestError(method, budget));
        }, budget);
        // A budget must not hold a process open on its own account.
        timer.unref?.();
      }
      pending.set(id, entry);
      try {
        wire.write(`${JSON.stringify({ type: "request", id, method, params })}\n`);
      } catch (error) {
        reject(terminate(error instanceof Error ? error : new Error(String(error))));
      }
    });
  }

  return {
    queryElements: (params) => call("queryElements", params) as Promise<QueryElementsResult>,
    discoverElements: (params) => call("discoverElements", params) as Promise<DiscoverElementsResult>,
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
    describeAccessibility: (params) =>
      call("describeAccessibility", params ?? {}) as Promise<DescribeAccessibilityResult>,
    describeDesktop: (params) => call("describeDesktop", params ?? {}) as Promise<DescribeDesktopResult>,
    acquireAccessibility: (params) =>
      call("acquireAccessibility", params ?? {}) as Promise<AcquireAccessibilityResult>,
    restartApplication: (params) => call("restartApplication", params) as Promise<RestartApplicationResult>,
    sendKeyChord: (params) => call("sendKeyChord", params) as Promise<SendKeyChordResult>,
    typeText: (params) => call("typeText", params) as Promise<TypeTextResult>,
    clearElementText: (params) => call("clearElementText", params) as Promise<ClearElementTextResult>,
    clickElement: (params) => call("clickElement", params) as Promise<ClickElementResult>,
    captureElement: (params) => call("captureElement", params) as Promise<CaptureElementResult>,
    onChangeEvent: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close: () => {
      terminate(new Error(`transport: connection to ${peer} closed`));
      wire.end();
    },
  };
}


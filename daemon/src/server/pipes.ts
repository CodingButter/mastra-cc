import { mkdirSync, rmSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { WebSocket } from "ws";
import { SCHEMA_DIGEST, PROTOCOL_VERSION } from "@mastra-cc/protocol-types";
import { type Backend } from "../backend.js";
import { refused } from "../audit.js";
import { type Visibility } from "../grants.js";
import { driverAuthority } from "../driver.js";
import { MAX_REQUEST_LINE_CHARS } from "../server.js";
import { Request, handleRequest } from "./dispatch.js";
import { LaunchContext } from "./grants.js";
import { MAX_IN_FLIGHT_REQUESTS, PipePressure, STALLED_CONSUMER_PENDING_BYTES, SubscriptionBook } from "./subscriptions.js";

/**
 * The narrow duplex the protocol front end actually needs. Exactly the members
 * the connection handler used to reach for on a net.Socket and nothing more -
 * a Unix socket and a WebSocket can both present this, so the handler below is
 * written once and driven by either.
 *
 * `write` takes a whole line INCLUDING its trailing newline. The newline is
 * part of the payload the protocol has always sent, not a socket-framing
 * detail, so it stays part of it on every pipe.
 */
export interface Pipe extends PipePressure {
  write(line: string): void;
  /** graceful: the peer is told we are done */
  end(): void;
  /** true once the pipe can no longer carry bytes */
  readonly closed: boolean;
  onData(handler: (chunk: string) => void): void;
  onClose(handler: () => void): void;
  /** stop / restart reading from the peer (ADR-0106 amendment) */
  pause(): void;
  resume(): void;
}

export function socketPipe(socket: Socket): Pipe {
  return {
    write: (line) => {
      socket.write(line);
    },
    pending: () => socket.writableLength,
    onDrain: (handler) => {
      socket.on("drain", handler);
    },
    end: () => {
      socket.end();
    },
    get closed() {
      return socket.destroyed;
    },
    onData: (handler) => {
      // One decoder per connection: a multi-byte character split across two
      // TCP chunks must be joined, not turned into two replacement characters.
      const decoder = new StringDecoder("utf8");
      socket.on("data", (chunk: Buffer) => handler(decoder.write(chunk)));
    },
    onClose: (handler) => {
      socket.on("close", handler);
    },
    pause: () => {
      socket.pause();
    },
    resume: () => {
      socket.resume();
    },
  };
}

/**
 * The whole protocol front end for ONE connection: the hello gate, the
 * newline-delimited framing, request routing, the server-initiated event
 * direction, and the teardown that closes watches at the backend.
 *
 * Lives here, once, and is called by every listener. A second copy of this
 * logic - or a second framing rule for a pipe whose transport happens to have
 * message boundaries of its own - is how two pipes stop being the same pipe.
 */
export function serveConnection(
  pipe: Pipe,
  options: { backend: Backend; launch?: LaunchContext; visibility: Visibility },
): void {
  const { backend, launch, visibility } = options;
  const authority = driverAuthority(backend);
  const driver = { authority, connection: authority.connect() };
  let buffer = "";
  let helloDone = false;
  // The server-initiated direction (ADR-0039). An event answers nothing, so
  // it carries no id - a client that is not listening ignores it, and a
  // client that is gets it without having asked twice.
  const book = new SubscriptionBook((event) => {
    if (!pipe.closed) pipe.write(`${JSON.stringify({ type: "event", event })}\n`);
  }, visibility, pipe);
  // A watch belongs to the connection that asked for it. When the connection
  // goes, the watches go with it - closed at the BACKEND, not merely
  // forgotten here: a forgotten watch is still being fed.
  const teardown = () => {
    // The close is the cancellation request. The acknowledgement is ownership
    // retiring, which happens now if nothing is running and at the running
    // effect's next boundary otherwise; the gap between them is the one
    // number CC-09 asks for, so it is written where the operator can read it.
    const requested = performance.now();
    if (authority.running(driver.connection)) {
      void authority.settled(driver.connection).then((at) => {
        console.error(`daemon: driver ${driver.connection.generation} settled ${(at - requested).toFixed(1)} ms after its connection closed mid-effect`);
      });
    }
    authority.disconnect(driver.connection);
    void book.closeAll();
  };
  pipe.onClose(teardown);
  let overlong = false;
  // Responses are held to the same stalled-consumer bound as events
  // (ADR-0106 amendment). A response cannot be coalesced or dropped, so the
  // bound is kept on the request side: while the peer is not reading what it
  // already asked for (over the pending-byte bound) or has
  // MAX_IN_FLIGHT_REQUESTS unanswered, no further request is dispatched and
  // the peer is not read. Requests resume, in order, when the pipe drains or
  // an answer lands.
  let inFlight = 0;
  let inOrder: Promise<unknown> = Promise.resolve();
  let paused = false;
  const held = () => pipe.pending() > STALLED_CONSUMER_PENDING_BYTES || inFlight >= MAX_IN_FLIGHT_REQUESTS;
  const pump = () => {
    if (!paused || pipe.closed || held()) return;
    paused = false;
    pipe.resume();
    readLines();
  };
  pipe.onDrain(pump);
  pipe.onData((chunk) => {
    if (overlong || pipe.closed) return;
    // Search only the new text: re-scanning the whole buffer per chunk is quadratic in a long line.
    const searchFrom = buffer.length;
    buffer += chunk;
    if (buffer.length > MAX_REQUEST_LINE_CHARS && buffer.lastIndexOf("\n") < buffer.length - MAX_REQUEST_LINE_CHARS) {
      buffer = "";
      overlong = true;
      pipe.write(`${JSON.stringify({ type: "refusal", refusal: `daemon: a request line exceeded ${MAX_REQUEST_LINE_CHARS} characters without a newline` })}\n`);
      pipe.end();
      return;
    }
    if (buffer.indexOf("\n", searchFrom) >= 0 && !paused) readLines();
  });
  function readLines(): void {
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      if (helloDone && held()) {
        paused = true;
        pipe.pause();
        return;
      }
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line.trim()) continue;
      let message: { type: string; digest?: string; id?: number; method?: string; params?: unknown };
      try {
        message = JSON.parse(line);
      } catch {
        pipe.write(`${JSON.stringify({ type: "refusal", refusal: "daemon: not a JSON line" })}\n`);
        continue;
      }
      if (!helloDone) {
        if (message.type !== "hello" || typeof message.digest !== "string") {
          pipe.write(`${JSON.stringify({ type: "refusal", refusal: "daemon: hello with a schema digest must come first" })}\n`);
          pipe.end();
          return;
        }
        if (message.digest !== SCHEMA_DIGEST) {
          pipe.write(
            `${JSON.stringify({
              type: "refusal",
              refusal:
                `daemon: refused at connect - this daemon speaks schema digest ${SCHEMA_DIGEST} ` +
                `but the transport was built against schema digest ${message.digest} (digest-agreement check)`,
            })}\n`,
          );
          pipe.end();
          return;
        }
        helloDone = true;
        pipe.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST, version: PROTOCOL_VERSION })}\n`);
        continue;
      }
      if (message.type === "request" && typeof message.id === "number" && typeof message.method === "string") {
        inFlight++;
        // One connection's requests run in the order it sent them; only
        // requests from different connections may overlap (per-target queues).
        const handled = inOrder.then(() => handleRequest(message as Request, backend, launch, book, driver));
        inOrder = handled.catch(() => undefined);
        void handled.then((response) => {
          inFlight--;
          if (!pipe.closed) pipe.write(`${JSON.stringify(response)}\n`);
          pump();
        });
      } else {
        // Valid JSON that is not a well-formed request gets a named refusal,
        // never silence - a swallowed line leaves the client's promise
        // pending forever, which is a hang, not a refusal.
        pipe.write(
          `${JSON.stringify({
            type: "refusal",
            refusal: 'daemon: a message after hello must be {type:"request", id:number, method:string} - refusing a malformed line',
          })}\n`,
        );
      }
    }
  }
}

export function startServer(options: {
  socketPath: string;
  backend: Backend;
  launch?: LaunchContext;
  /** the observe set composed at boot; events are filtered against it at emission */
  visibility?: Visibility;
}): Promise<Server> {
  const { socketPath, backend, visibility = "all" } = options;
  // ONE composed observe set, carried into the launch context rather than
  // passed twice: the listing reports the observe capability from the same set
  // that filters events and hides subtrees, so the two can never disagree.
  const launch = options.launch === undefined ? undefined : { ...options.launch, visibility };
  mkdirSync(dirname(socketPath), { recursive: true });

  const server = createServer((socket) => {
    // The error -> hard drop behaviour stays in the adapter rather than in
    // serveConnection: "a socket error means destroy it" is a property of this
    // pipe, not of the protocol. The WebSocket adapter makes the same choice
    // with the vocabulary its own transport has.
    socket.on("error", () => socket.destroy());
    serveConnection(socketPipe(socket), { backend, launch, visibility });
  });

  return claimSocketPath(socketPath).then(
    () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, () => resolve(server));
      }),
  );
}

/**
 * A socket path belongs to the daemon listening on it (ADR-0115). A file at
 * the path is removed only when nothing answers there - a stale leftover.
 * If a live daemon answers, starting a second one refuses rather than
 * orphaning every client of the first. Two daemons starting in the same
 * instant can still race; that window is accepted.
 */
export function claimSocketPath(socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createConnection(socketPath);
    probe.once("connect", () => {
      probe.destroy();
      reject(
        new Error(
          `daemon: a daemon is already listening at ${socketPath} - refusing to start a second one over it; stop the first, or choose another --socket`,
        ),
      );
    });
    probe.once("error", (error: NodeJS.ErrnoException) => {
      probe.destroy();
      if (error.code === "ECONNREFUSED" || error.code === "ENOENT") {
        rmSync(socketPath, { force: true });
        resolve();
      } else reject(error);
    });
  });
}

export function webSocketPipe(socket: WebSocket): Pipe {
  // ws has no drain event; a send's callback fires once its frame has been
  // handed to the underlying socket. When that leaves nothing buffered and
  // something was held while it was, that is the drain.
  const drains: Array<() => void> = [];
  let pressed = false;
  return {
    write: (line) => {
      socket.send(line, () => {
        if (!pressed || socket.bufferedAmount > 0) return;
        pressed = false;
        for (const handler of drains) handler();
      });
    },
    pending: () => {
      if (socket.bufferedAmount > STALLED_CONSUMER_PENDING_BYTES) pressed = true;
      return socket.bufferedAmount;
    },
    onDrain: (handler) => {
      drains.push(handler);
    },
    end: () => {
      socket.close();
    },
    get closed() {
      // CLOSING (2) and CLOSED (3) both mean no more bytes will land
      return socket.readyState > 1;
    },
    onData: (handler) => {
      // Whole frames are fed into the SAME newline buffer the socket path
      // uses. A WebSocket has message boundaries of its own; the protocol
      // does not care about them, and pretending it does is how a peer that
      // batches two lines into one frame starts behaving differently.
      const decoder = new StringDecoder("utf8");
      socket.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
        handler(decoder.write(Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer)));
      });
    },
    onClose: (handler) => {
      socket.on("close", handler);
    },
    pause: () => {
      socket.pause();
    },
    resume: () => {
      socket.resume();
    },
  };
}

/** the handle a second listener hands back - deliberately NOT a net.Server */
export interface WebSocketListener {
  /** the port actually bound, which matters when the caller asked for 0 */
  readonly port: number;
  readonly host: string;
  close(): void;
  on(event: "close", handler: () => void): void;
}

/**
 * The same protocol, over a WebSocket, for a client that is not on this
 * filesystem. Additive: startServer above is untouched, and a daemon nobody
 * asked for a port never calls this.
 */
export async function startWebSocketServer(options: {
  port: number;
  host?: string;
  backend: Backend;
  launch?: LaunchContext;
  visibility?: Visibility;
  // Browser origins allowed to open a connection (audit M6). A web page on any
  // site can open a WebSocket to a loopback port, and the browser sends that
  // page's Origin with it. With none listed, every browser page is refused.
  // A handshake with no Origin at all is not a browser page and is unaffected.
  allowedOrigins?: ReadonlySet<string>;
}): Promise<WebSocketListener> {
  const { port, host = "127.0.0.1", backend, visibility = "all", allowedOrigins = new Set<string>() } = options;
  const launch = options.launch === undefined ? undefined : { ...options.launch, visibility };

  const { WebSocketServer } = await import("ws");
  const wss = new WebSocketServer({
    host,
    port,
    verifyClient: ({ req }: { req: { headers: Record<string, string | string[] | undefined> } }) => {
      const origin = req.headers.origin;
      return origin === undefined || (typeof origin === "string" && allowedOrigins.has(origin));
    },
  });

  wss.on("connection", (socket: WebSocket) => {
    // Same choice the socket adapter makes: a transport-level error means drop
    // this connection, and that is a property of the pipe, not the protocol.
    socket.on("error", () => socket.terminate());
    serveConnection(webSocketPipe(socket), { backend, launch, visibility });
  });

  return new Promise((resolve, reject) => {
    wss.once("error", reject);
    wss.once("listening", () => {
      const address = wss.address();
      const bound = address !== null && typeof address === "object" ? address.port : port;
      resolve({
        port: bound,
        host,
        close: () => wss.close(),
        on: (event, handler) => wss.on(event, handler),
      });
    });
  });
}

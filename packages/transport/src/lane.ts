import { createConnection, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";

// THE LANE WIRE (ADR-0052) - transport's second wire, and its fifth
// responsibility.
//
// This is NOT the daemon wire. Different peer, different vocabulary, no digest
// handshake: the daemon wire's digest works because both ends are generated
// from `protocol/schema.json`, and the lane vocabulary is not generated. Its
// equivalent guarantee is below - a frame naming an event outside the frozen
// four is refused where it arrives instead of being handed to a renderer that
// will do something with it.
//
// WHY THE VOCABULARY IS DECLARED HERE and not in the hub, where it was born:
// the carrier is the lowest layer that must know the four names, and both ends
// need them. The hub sits above this package and imports it; this package
// cannot import the hub back. The alternative was a second copy of four strings
// on the client side, which is the three-copy problem ADR-0003 exists to
// prevent, arriving as a four-string version of itself. So there is exactly one
// declaration and both ends import it. The hub's own test still asserts the SET
// against `docs/01-ARCHITECTURE.md`, so the words are still pinned to the
// document rather than to whichever file happens to hold them.

/**
 * The vocabulary, verbatim from `docs/01-ARCHITECTURE.md:125-128` including the
 * meanings, because the meaning is the part that drifted.
 *
 * - `progress` - the agent is working; here is what it is doing
 * - `answer` - the agent has something to say to the person
 * - `voice_opened` - a voice session became active somewhere
 * - `voice_closed` - the last voice session ended
 */
export const LANE_EVENTS = ["progress", "answer", "voice_opened", "voice_closed"] as const;
export type LaneEvent = (typeof LANE_EVENTS)[number];

export interface LaneFrame {
  readonly event: LaneEvent;
  /** What the agent is doing, or has to say. Absent on the voice edges, which carry no prose. */
  readonly detail?: string;
}

/** True when a parsed line is a frame this wire is allowed to deliver. */
export function isLaneFrame(value: unknown): value is LaneFrame {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as { event?: unknown; detail?: unknown };
  if (!LANE_EVENTS.includes(frame.event as LaneEvent)) return false;
  return frame.detail === undefined || typeof frame.detail === "string";
}

/**
 * What the server end needs from the hub. Structural on purpose: this package
 * sits below the hub and must not import it, and the hub's `LaneHub` satisfies
 * this without knowing the wire exists.
 */
export interface LaneSource {
  join(deliver: (frame: LaneFrame) => void, ping?: () => void): {
    pong(): void;
    said(): void;
    readonly open: boolean;
  };
}

export interface LaneServer {
  /**
   * Write a raw line to every connected client. This exists for the one test
   * that must produce a frame the hub would never send; nothing in the shipped
   * path calls it.
   */
  sendRaw(line: string): void;
  readonly connections: number;
  close(): Promise<void>;
}

export function defaultLaneSocketPath(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR ?? "/tmp";
  return join(runtimeDir, "mastra-cc", "lane.sock");
}

export interface LaneClient {
  /** The peer said something a person caused. Not a pong - the hub's clock only moves for this. */
  said(): void;
  readonly connected: boolean;
  close(): Promise<void>;
}

export async function serveLane(options: {
  source: LaneSource;
  socketPath: string;
}): Promise<LaneServer> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    // The joining client is handed the current state by the hub, on this
    // socket alone (PR #230). Deleting the delivery here loses the edge for
    // every late joiner while every test that connects first stays green.
    const connection = options.source.join(
      (frame) => socket.write(`${JSON.stringify(frame)}\n`),
      () => socket.write(`${JSON.stringify({ type: "ping" })}\n`),
    );
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;
        let message: { type?: unknown };
        try {
          message = JSON.parse(line) as { type?: unknown };
        } catch {
          continue;
        }
        // A PONG IS NOT SPEECH, and the distinction is made here because this
        // is where the two arrive on the same socket.
        if (message.type === "pong") connection.pong();
        else if (message.type === "said") connection.said();
      }
    });
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socketPath, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  return {
    sendRaw(line) {
      for (const socket of sockets) socket.write(line);
    },
    get connections() {
      return sockets.size;
    },
    close() {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function dialLane(options: {
  socketPath: string;
  deliver: (frame: LaneFrame) => void;
  /** Called with the reason a line was not delivered. A client that silently drops is a client that lies. */
  onRefusal?: (reason: string) => void;
}): Promise<LaneClient> {
  const socket = createConnection(options.socketPath);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => {
      socket.removeListener("error", reject);
      resolve();
    });
    socket.once("error", reject);
  });

  let buffer = "";
  let connected = true;
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line) continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        options.onRefusal?.(`lane: peer sent a line that is not JSON - refusing to deliver it`);
        continue;
      }
      if ((message as { type?: unknown }).type === "ping") {
        socket.write(`${JSON.stringify({ type: "pong" })}\n`);
        continue;
      }
      // THE VOCABULARY GUARANTEE, at the point of arrival. A frame naming a
      // fifth event is refused here rather than delivered to a renderer that
      // would have to decide what to do with it.
      if (!isLaneFrame(message)) {
        options.onRefusal?.(
          `lane: refusing a frame naming "${String((message as { event?: unknown }).event)}" - ` +
            `the lane vocabulary is exactly ${LANE_EVENTS.join(", ")}`,
        );
        continue;
      }
      options.deliver(message);
    }
  });
  socket.on("close", () => {
    connected = false;
  });

  return {
    said() {
      socket.write(`${JSON.stringify({ type: "said" })}\n`);
    },
    get connected() {
      return connected;
    },
    close() {
      return new Promise<void>((resolve) => {
        if (socket.destroyed) return resolve();
        socket.once("close", () => resolve());
        socket.destroy();
      });
    },
  };
}

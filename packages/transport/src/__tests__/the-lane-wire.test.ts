import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  dialLane,
  isLaneFrame,
  LANE_EVENTS,
  type LaneClient,
  type LaneFrame,
  type LaneServer,
  type LaneSource,
  serveLane,
} from "../lane.js";

// THE SECOND WIRE (ADR-0052).
//
// What is tested here is the CARRIER, not the lane semantics: the hub's own
// suite asserts that the vocabulary is exactly four names and that a late
// joiner is handed the current state. This file asserts those guarantees
// survive a socket, which is a different claim - a hub that hands a joining
// client the voice state is worth nothing if the carrier delivers it before the
// client is listening, drops it, or renders a fifth event the hub never named.
//
// The source here is a MINIATURE of the hub's lane behaviour rather than the
// hub itself: this package sits below the hub and importing it would be a
// dependency cycle. The miniature implements the same structural contract the
// real `LaneHub` satisfies, and the real one is exercised end to end by the
// widget's suite one layer up.

const dirs: string[] = [];
const running: Array<LaneServer | LaneClient> = [];

function socketPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "lane-wire-"));
  dirs.push(dir);
  return join(dir, "lane.sock");
}

afterEach(async () => {
  for (const thing of running.splice(0)) await thing.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Peer {
  deliver: (frame: LaneFrame) => void;
  ping: () => void;
  awaitingPong: boolean;
  saidAt: number;
  open: boolean;
}

/** The hub's lane behaviour, small enough to read, with the same shape the real one has. */
function miniature(options: { voiceOpen?: boolean } = {}) {
  const peers = new Set<Peer>();
  let clock = 0;
  const source: LaneSource = {
    join(deliver, ping = () => {}) {
      const peer: Peer = { deliver, ping, awaitingPong: false, saidAt: (clock += 1), open: true };
      peers.add(peer);
      if (options.voiceOpen) deliver({ event: "voice_opened" });
      return {
        pong: () => {
          peer.awaitingPong = false;
        },
        said: () => {
          peer.awaitingPong = false;
          peer.saidAt = clock += 1;
        },
        get open() {
          return peer.open;
        },
      };
    },
  };
  return {
    source,
    publish: (event: "progress" | "answer", detail: string) => {
      for (const peer of peers) if (peer.open) peer.deliver({ event, detail });
    },
    sweep: () => {
      for (const peer of [...peers]) {
        if (peer.awaitingPong) {
          peer.open = false;
          peers.delete(peer);
          continue;
        }
        peer.awaitingPong = true;
        peer.ping();
      }
    },
    only: () => {
      const peer = [...peers][0];
      if (!peer) throw new Error("no peer joined");
      return peer;
    },
    peerCount: () => peers.size,
  };
}

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`the wire never satisfied: ${what}`);
}

function collector() {
  const frames: LaneFrame[] = [];
  return { frames, deliver: (frame: LaneFrame) => frames.push(frame) };
}

describe("the lane wire", () => {
  it("carries a published event to a connected client", async () => {
    const hub = miniature();
    const path = socketPath();
    const server = await serveLane({ source: hub.source, socketPath: path });
    running.push(server);
    const seen = collector();
    running.push(await dialLane({ socketPath: path, deliver: seen.deliver }));
    await until(() => hub.peerCount() === 1, "the server saw the client");

    hub.publish("progress", "reading the mail");
    await until(() => seen.frames.length > 0, "a published frame arrived");

    expect(seen.frames).toEqual([{ event: "progress", detail: "reading the mail" }]);
  });

  // THE PR #230 BUG, ASSERTED FROM THE CLIENT SIDE.
  //
  // `voice_opened` is an edge. A client that dials after it fired can never
  // learn the state and sits in the wrong mode forever. This asserts the
  // carrier delivers the state to a client that was not there when it fired.
  it("tells a client that dialled mid-session what the voice state already is", async () => {
    const hub = miniature({ voiceOpen: true });
    const path = socketPath();
    running.push(await serveLane({ source: hub.source, socketPath: path }));
    const seen = collector();
    running.push(await dialLane({ socketPath: path, deliver: seen.deliver }));

    await until(() => seen.frames.length > 0, "the joining client heard the current state");
    expect(seen.frames).toEqual([{ event: "voice_opened" }]);
  });

  it("does not invent an open session for a client that dialled when none was running", async () => {
    const hub = miniature();
    const path = socketPath();
    running.push(await serveLane({ source: hub.source, socketPath: path }));
    const seen = collector();
    running.push(await dialLane({ socketPath: path, deliver: seen.deliver }));
    await until(() => hub.peerCount() === 1, "the server saw the client");

    hub.publish("progress", "working");
    await until(() => seen.frames.length > 0, "some frame arrived");

    expect(seen.frames).toEqual([{ event: "progress", detail: "working" }]);
  });

  // THE VOCABULARY GUARANTEE AT THE POINT OF ARRIVAL (ADR-0052).
  //
  // The daemon wire refuses at connect on a digest mismatch. This wire has no
  // digest because the vocabulary is not generated, so the equivalent
  // guarantee is that a frame outside the frozen four never reaches a renderer.
  it("refuses a frame naming an event outside the frozen four rather than delivering it", async () => {
    const hub = miniature();
    const path = socketPath();
    const server = await serveLane({ source: hub.source, socketPath: path });
    running.push(server);
    const seen = collector();
    const refusals: string[] = [];
    running.push(
      await dialLane({
        socketPath: path,
        deliver: seen.deliver,
        onRefusal: (reason) => refusals.push(reason),
      }),
    );
    await until(() => hub.peerCount() === 1, "the server saw the client");

    server.sendRaw(`${JSON.stringify({ event: "reboot", detail: "now" })}\n`);
    await until(() => refusals.length > 0, "the client refused an unknown event");

    expect(seen.frames).toEqual([]);
    expect(refusals[0]).toContain("reboot");
  });

  it("refuses a line that is not JSON instead of dying in a data handler", async () => {
    const hub = miniature();
    const path = socketPath();
    const server = await serveLane({ source: hub.source, socketPath: path });
    running.push(server);
    const seen = collector();
    const refusals: string[] = [];
    running.push(
      await dialLane({ socketPath: path, deliver: seen.deliver, onRefusal: (r) => refusals.push(r) }),
    );
    await until(() => hub.peerCount() === 1, "the server saw the client");

    server.sendRaw("this is not json\n");
    await until(() => refusals.length > 0, "the client refused the junk line");

    // Still alive: a good frame after a bad line still arrives.
    hub.publish("answer", "still here");
    await until(() => seen.frames.length > 0, "the wire survived the junk line");
    expect(seen.frames).toEqual([{ event: "answer", detail: "still here" }]);
  });

  // A PONG IS NOT SPEECH. The client answers pings automatically, so a face
  // that has frozen still pongs - counting that as the session having said
  // something would report a frozen face as freshly active.
  it("answers a ping without the answer counting as the peer having said something", async () => {
    const hub = miniature();
    const path = socketPath();
    running.push(await serveLane({ source: hub.source, socketPath: path }));
    const seen = collector();
    running.push(await dialLane({ socketPath: path, deliver: seen.deliver }));
    await until(() => hub.peerCount() === 1, "the server saw the client");

    const before = hub.only().saidAt;
    hub.sweep();
    await until(() => !hub.only().awaitingPong, "the client answered the ping");

    expect(hub.only().saidAt).toBe(before);
    expect(hub.only().open).toBe(true);
  });

  it("hangs up a client that stops answering", async () => {
    const hub = miniature();
    const path = socketPath();
    running.push(await serveLane({ source: hub.source, socketPath: path }));
    const seen = collector();
    const client = await dialLane({ socketPath: path, deliver: seen.deliver });
    await until(() => hub.peerCount() === 1, "the server saw the client");

    // The peer goes quiet: its end is gone, so no pong comes back and it still
    // owes an answer at the next sweep.
    await client.close();
    hub.sweep();
    hub.sweep();

    expect(hub.peerCount()).toBe(0);
  });

  it("moves the clock when the peer says something a person caused", async () => {
    const hub = miniature();
    const path = socketPath();
    running.push(await serveLane({ source: hub.source, socketPath: path }));
    const seen = collector();
    const client = await dialLane({ socketPath: path, deliver: seen.deliver });
    running.push(client);
    await until(() => hub.peerCount() === 1, "the server saw the client");

    const before = hub.only().saidAt;
    client.said();
    await until(() => hub.only().saidAt !== before, "the hub heard the peer speak");

    expect(hub.only().saidAt).toBeGreaterThan(before);
  });

  it("judges a frame by the whole vocabulary, not by the shape of one field", () => {
    for (const event of LANE_EVENTS) expect(isLaneFrame({ event })).toBe(true);
    expect(isLaneFrame({ event: "progress", detail: "x" })).toBe(true);
    expect(isLaneFrame({ event: "reboot" })).toBe(false);
    expect(isLaneFrame({ event: "progress", detail: 7 })).toBe(false);
    expect(isLaneFrame(null)).toBe(false);
    expect(isLaneFrame("progress")).toBe(false);
  });
});

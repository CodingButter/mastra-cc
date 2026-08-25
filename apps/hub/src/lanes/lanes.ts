// THE FOUR LANES.
//
// A lane is a named stream between hub and clients, and its vocabulary is
// exact: `docs/01-ARCHITECTURE.md:121` says it "is not to be paraphrased -
// the prototype's bugs in this area were all vocabulary drift". So the four
// names are declared once, as a frozen set, and the test asserts the SET
// rather than sampling it: a fifth event cannot appear unnoticed and a rename
// cannot slip through a membership check.
//
// WHAT CARRIES THESE EVENTS, stated plainly because a reviewer cannot tell it
// from a green pin: this module is IN-PROCESS. It opens no socket and no
// WebSocket server. Boundary pin B5 greps for `node:net` imports, so it is
// silent here - and it is silent for the right reason rather than by luck,
// because there is no second socket implementation to find. M4 brought the
// first client, and its carrier landed inside `packages/transport` (ADR-0052),
// never beside it. A WebSocket server growing in the hub would leave B5 green
// while the boundary it exists to defend was breached, which is exactly why the
// carrier is named here in prose instead of inferred from a passing pin.

// THE VOCABULARY MOVED DOWN, and this file consumes it rather than declaring a
// second copy. M4 gave the events a carrier (ADR-0052), and the carrier is the
// lowest layer that must know the four names: both ends of the wire need them,
// and `packages/transport` cannot import the hub back. Re-declaring them here
// would be the three-copy problem arriving as four strings. The SET is still
// asserted against `docs/01-ARCHITECTURE.md` by this package's test, so the
// words remain pinned to the document rather than to whichever file holds them.
export { LANE_EVENTS, type LaneEvent, type LaneFrame } from "@mastra-cc/transport";
import type { DirectednessRequest, DirectednessResult, LaneFrame, VoiceDialRequest, VoiceDialResult } from "@mastra-cc/transport";
import { createVoiceSessionOwner } from "../voice/session.js";

export interface LaneConnection {
  /**
   * The peer answered a ping.
   *
   * A PONG IS NOT SPEECH. The architecture is explicit that the heartbeat "does
   * not count as the session having said something, because pongs are answered
   * by the transport, not by page code - counting them would report a frozen
   * face as freshly active". So this clears the outstanding ping and touches
   * nothing else.
   */
  pong(): void;
  /** The peer sent something a person caused. This is what "said something" means, and it is the only thing that refreshes the clock. */
  said(): void;
  /** Classify a provisional opening without counting gate machinery as speech. */
  classifyDirectedness(request: DirectednessRequest): Promise<DirectednessResult>;
  /** Mint one provider ticket without confusing a capability request for speech. */
  mintVoiceDial(request: VoiceDialRequest): Promise<VoiceDialResult>;
  openVoiceSession(): void;
  closeVoiceSession(): void;
  /** When the peer last actually said something. A connection kept alive purely by heartbeats does not move this. */
  readonly saidAt: number;
  readonly open: boolean;
}

export interface LaneHub {
  /**
   * A client joins. It is handed the CURRENT voice state before anything else,
   * because `voice_opened` and `voice_closed` are edges: a client that connects
   * after the edge fired can never learn the state and sits in the wrong mode
   * forever (PR #230, and a real bug before it was one).
   */
  join(deliver: (frame: LaneFrame) => void, ping?: () => void): LaneConnection;
  /** Broadcast to every open connection. */
  publish(event: "progress" | "answer", detail: string): void;
  openVoiceSession(session: string): void;
  closeVoiceSession(session: string): void;
  /** How many voice sessions are active anywhere. The edges are tied to this reaching one and returning to zero. */
  readonly voiceSessions: number;
  /**
   * One heartbeat sweep. Every connection is pinged; a peer that still owes an
   * answer from the PREVIOUS sweep is hung up. A suspended laptop leaves a
   * socket open to the kernel and the close edge never fires, so the lane asks
   * rather than waits.
   */
  sweep(): void;
}

interface Peer {
  deliver: (frame: LaneFrame) => void;
  ping: () => void;
  awaitingPong: boolean;
  saidAt: number;
  open: boolean;
}

export interface LaneHubOptions {
  /** The clock, so a test can say when things happened instead of sleeping. */
  readonly now?: () => number;
  readonly classifyDirectedness?: (request: DirectednessRequest) => Promise<DirectednessResult>;
  readonly mintVoiceDial?: (request: VoiceDialRequest) => Promise<VoiceDialResult>;
}

export function createLaneHub(options: LaneHubOptions = {}): LaneHub {
  const now = options.now ?? Date.now;
  const classifyDirectedness =
    options.classifyDirectedness ??
    ((request: DirectednessRequest) =>
      Promise.resolve({
        type: "directedness_result" as const,
        id: request.id,
        verdict: "uncertain" as const,
        reason: "unconfigured" as const,
      }));
  const mintVoiceDial =
    options.mintVoiceDial ??
    ((request: VoiceDialRequest) =>
      Promise.resolve({
        type: "voice_dial_result" as const,
        id: request.id,
        ok: false as const,
        status: 409,
        code: "UNCONFIGURED",
        refusal: "voice: this hub has no configured dial capability",
      }));
  const peers = new Set<Peer>();
  // Named sessions, not a counter: two opens of the same session must not take
  // two closes to undo, and a stale close must not cancel a live session.
  const sessions = new Set<string>();

  function broadcast(frame: LaneFrame): void {
    for (const peer of peers) if (peer.open) peer.deliver(frame);
  }

  function hangUp(peer: Peer): void {
    peer.open = false;
    peers.delete(peer);
  }

  function closeSession(session: string): void {
    if (!sessions.delete(session)) return;
    if (sessions.size === 0) broadcast({ event: "voice_closed" });
  }

  const voiceOwner = createVoiceSessionOwner({
    now,
    close: (session) => closeSession(session),
  });

  function openSession(session: string): void {
    const first = sessions.size === 0;
    sessions.add(session);
    voiceOwner.open(session);
    if (first) broadcast({ event: "voice_opened" });
  }

  let nextPeerSession = 1;

  return {
    join(deliver, ping = () => {}) {
      const peer: Peer = { deliver, ping, awaitingPong: false, saidAt: now(), open: true };
      const sessionId = `peer-${nextPeerSession++}`;
      peers.add(peer);
      // TO THIS CLIENT ALONE. Broadcasting the current state would tell every
      // other client a session opened that did not. Deleting this line is the
      // mutation `the-late-joiner-hears-silence`.
      if (sessions.size > 0) deliver({ event: "voice_opened" });
      // ONE PLACE RECEIVES FROM THE PEER, so the distinction between a pong and
      // a person lives on one line instead of being spread across two methods
      // that must agree. Anything arriving from the peer proves the socket is
      // alive and clears the outstanding ping; only speech moves the clock.
      const received = (kind: "pong" | "said") => {
        peer.awaitingPong = false;
        // A PONG IS NOT SPEECH. Deleting this line is the mutation
        // `the-heartbeat-that-counts-as-speech`: a frozen face reports as
        // freshly active and a dead session stays alive forever by virtue of
        // the machinery watching it.
        if (kind === "pong") return;
        peer.saidAt = now();
        voiceOwner.activity("speech");
      };
      return {
        pong: () => received("pong"),
        said: () => received("said"),
        classifyDirectedness,
        mintVoiceDial,
        openVoiceSession: () => openSession(sessionId),
        closeVoiceSession: () => closeSession(sessionId),
        get saidAt() {
          return peer.saidAt;
        },
        get open() {
          return peer.open;
        },
      };
    },

    publish(event, detail) {
      broadcast({ event, detail });
    },

    openVoiceSession(session) {
      // The edge is the FIRST session becoming active, not every session: a
      // second machine joining a conversation already in progress did not make
      // a voice session "become active somewhere" - it already was.
      openSession(session);
    },

    closeVoiceSession(session) {
      voiceOwner.close(session);
      // THE LAST ONE. `voice_closed` means "the last voice session ended", so
      // it fires on the set emptying and not on any earlier close. Firing on
      // the first would unplug every other client's ears mid-conversation.
      closeSession(session);
    },

    get voiceSessions() {
      return sessions.size;
    },

    sweep() {
      voiceOwner.sweep();
      for (const peer of [...peers]) {
        if (peer.awaitingPong) {
          hangUp(peer);
          continue;
        }
        peer.awaitingPong = true;
        peer.ping();
      }
    },
  };
}

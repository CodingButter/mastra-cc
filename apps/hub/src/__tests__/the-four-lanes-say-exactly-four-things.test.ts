// FOUR LANE EVENTS, AN EDGE A LATE JOINER STILL HEARS, AND A HEARTBEAT THAT IS
// NOT SPEECH.
//
// The vocabulary assertions here are set assertions on purpose. Every bug the
// prototype had in this area was vocabulary drift, and a membership check -
// "progress is one of the events" - passes happily while a fifth event grows
// beside it and while `voice_closed` gets renamed to something a client no
// longer recognises.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLaneHub, LANE_EVENTS, type LaneFrame } from "../lanes/lanes.js";

/** Collects what one client was actually delivered, in order. */
function client(): { frames: LaneFrame[]; deliver: (frame: LaneFrame) => void } {
  const frames: LaneFrame[] = [];
  return { frames, deliver: (frame) => frames.push(frame) };
}

describe("the four lanes say exactly four things", () => {
  it("the event vocabulary is exactly four names, and they are the architecture's own words", () => {
    // The SET. A fifth event fails this, a rename fails this, and a reorder
    // fails it too - which is deliberate, because the table in the
    // architecture document is the source and its order is part of the quote.
    expect([...LANE_EVENTS]).toEqual(["progress", "answer", "voice_opened", "voice_closed"]);

    // And they are the document's words, read from the document rather than
    // retyped from memory. A vocabulary asserted only against itself is a
    // vocabulary that can drift as a pair.
    const architecture = readFileSync(join(import.meta.dirname, "../../../../docs/01-ARCHITECTURE.md"), "utf8");
    const table = architecture.slice(architecture.indexOf("| Lane event | Meaning |"));
    // NO SLICE. Taking the first four rows would let a fifth row be appended to
    // the table without a word of complaint, and the pair would stop being a
    // pair while both halves stayed green - review's catch. The table's row
    // count is part of the assertion.
    const declared = [...table.matchAll(/^\| `([a-z_]+)` \| (.+?) \|$/gm)];
    expect(declared).toHaveLength(4);
    expect(declared.map((m) => m[1])).toEqual([...LANE_EVENTS]);
    expect(declared.map((m) => m[2])).toEqual([
      "the agent is working; here is what it is doing",
      "the agent has something to say to the person",
      "a voice session became active somewhere",
      "the last voice session ended",
    ]);
  });

  it("a client joining while a voice session is open is told the current state, and it alone is told", () => {
    const hub = createLaneHub();
    const early = client();
    hub.join(early.deliver);

    hub.openVoiceSession("session-a");
    expect(early.frames).toEqual([{ event: "voice_opened" }]);

    // The late joiner missed the edge. Without the on-connect state it sits in
    // the wrong mode forever, believing the house is silent while someone is
    // talking to it.
    const late = client();
    hub.join(late.deliver);
    expect(late.frames).toEqual([{ event: "voice_opened" }]);

    // And the client that was already here was not told a second time. A
    // broadcast on connect would announce a session opening that did not.
    expect(early.frames).toEqual([{ event: "voice_opened" }]);

    // A client joining into silence is told nothing, rather than told "closed"
    // - there is no edge to report and a spurious close is its own wrong mode.
    hub.closeVoiceSession("session-a");
    const quiet = client();
    hub.join(quiet.deliver);
    expect(quiet.frames).toEqual([]);
  });

  it("a silent connection is pinged, and one still owing an answer at the next sweep is hung up", () => {
    const hub = createLaneHub();
    const answering = client();
    const silent = client();
    let answeringPings = 0;
    let silentPings = 0;
    const alive = hub.join(answering.deliver, () => {
      answeringPings += 1;
    });
    const dead = hub.join(silent.deliver, () => {
      silentPings += 1;
    });

    hub.sweep();
    expect(answeringPings).toBe(1);
    expect(silentPings).toBe(1);
    expect(alive.open && dead.open).toBe(true);

    alive.pong();
    hub.sweep();

    // A suspended laptop leaves a socket open to the kernel; the close edge
    // never fires. The lane asks rather than waits, and hangs up the peer that
    // did not answer.
    expect(dead.open).toBe(false);
    expect(alive.open).toBe(true);

    // And a hung-up peer stops being delivered to, or the hub talks into a
    // socket nobody is reading forever.
    hub.publish("progress", "reading the message list");
    expect(answering.frames.at(-1)).toEqual({ event: "progress", detail: "reading the message list" });
    expect(silent.frames).toEqual([]);
  });

  it("directedness evaluation does not refresh the clock that says the session said something", async () => {
    let clock = 1_000;
    const hub = createLaneHub({
      now: () => clock,
      classifyDirectedness: async (request) => ({
        type: "directedness_result",
        id: request.id,
        verdict: "directed",
        reason: "addressed-mastra",
      }),
    });
    const peer = hub.join(client().deliver);
    const before = peer.saidAt;
    clock = 2_000;

    await peer.classifyDirectedness({
      type: "directedness_request",
      id: "opening-1",
      format: { sampleRate: 16_000, channels: 1, sampleFormat: "s16le" },
      audioBase64: "AQI=",
    });

    expect(peer.saidAt).toBe(before);
  });

  it("a heartbeat does not refresh the clock that says the session said something", () => {
    let clock = 1_000;
    const hub = createLaneHub({ now: () => clock });
    const peer = hub.join(client().deliver);
    expect(peer.saidAt).toBe(1_000);

    clock = 5_000;
    peer.pong();
    // A PONG IS NOT SPEECH. Pongs are answered by the transport, not by page
    // code, so counting one would report a frozen face as freshly active and a
    // dead session would stay alive forever by virtue of the machinery
    // watching it.
    expect(peer.saidAt).toBe(1_000);

    peer.said();
    expect(peer.saidAt).toBe(5_000);
  });

  it("closes an inactive client session once after exactly sixty seconds without actual speech", () => {
    let clock = 1_000;
    const hub = createLaneHub({ now: () => clock });
    const listener = client();
    hub.join(listener.deliver);
    const speaker = hub.join(client().deliver);

    speaker.openVoiceSession();
    expect(listener.frames).toEqual([{ event: "voice_opened" }]);

    clock += 59_999;
    hub.sweep();
    expect(hub.voiceSessions).toBe(1);

    speaker.pong();
    clock += 1;
    hub.sweep();
    expect(hub.voiceSessions).toBe(0);
    expect(listener.frames).toEqual([{ event: "voice_opened" }, { event: "voice_closed" }]);

    hub.sweep();
    speaker.closeVoiceSession();
    expect(listener.frames).toEqual([{ event: "voice_opened" }, { event: "voice_closed" }]);
  });

  it("voice_closed fires when the last session ends, not the first", () => {
    const hub = createLaneHub();
    const listener = client();
    hub.join(listener.deliver);

    hub.openVoiceSession("kitchen");
    hub.openVoiceSession("study");
    expect(hub.voiceSessions).toBe(2);
    // The second open is not an edge either: a voice session did not "become
    // active somewhere" - it already was.
    expect(listener.frames).toEqual([{ event: "voice_opened" }]);

    hub.closeVoiceSession("kitchen");
    expect(listener.frames).toEqual([{ event: "voice_opened" }]);
    expect(hub.voiceSessions).toBe(1);

    hub.closeVoiceSession("study");
    expect(listener.frames).toEqual([{ event: "voice_opened" }, { event: "voice_closed" }]);
    expect(hub.voiceSessions).toBe(0);

    // Closing a session that is not open changes nothing. A duplicate close
    // arriving late must not fire an edge over a conversation that is running.
    hub.openVoiceSession("study");
    hub.closeVoiceSession("kitchen");
    expect(listener.frames.at(-1)).toEqual({ event: "voice_opened" });
    expect(hub.voiceSessions).toBe(1);
  });
});

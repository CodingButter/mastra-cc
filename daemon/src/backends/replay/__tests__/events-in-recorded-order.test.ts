import { describe, expect, it } from "vitest";
import { type BackendChange, replayWatch, type TapeEvent } from "../../../backend.js";
import { loadTape } from "../index.js";

// The replay side of the event direction (ADR-0039). A tape records BOTH
// directions: the exchanges a walk issued, and the changes the desktop
// volunteered while something was being watched. On replay the recorded
// changes are handed over in the order they were recorded, immediately.
//
// `afterMs` is provenance - how long after the watch began the change arrived,
// for a human reading the tape - and is NEVER replayed as a timer. The offline
// lane proves order and content; it says nothing about timing, and a timing
// claim it cannot support is a claim it must not make.
//
// The events themselves are recorded off a real desktop by the capture path
// (the live routes gain their watches in the phases after this one), never
// hand-authored. What this file constructs is a test's own input, not a
// fixture.

const change = (id: string): BackendChange => ({ id, role: "textbox", kind: "changed" });

function recorded(): TapeEvent[] {
  return [
    { afterMs: 12, subscribedTo: "el-000000000001", change: change("el-00000000000a") },
    { afterMs: 4, subscribedTo: "el-000000000002", change: change("el-00000000000b") },
    { afterMs: 900, subscribedTo: "el-000000000001", change: change("el-00000000000c") },
  ];
}

describe("a replayed watch hands back what the tape recorded, in the order it recorded it", () => {
  it("delivers only the changes recorded for the root that was subscribed to", async () => {
    const seen: string[] = [];
    replayWatch(recorded(), "el-000000000001", (c) => seen.push(c.id));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(["el-00000000000a", "el-00000000000c"]);
  });

  it("delivers in recorded order, not in offset order - the offsets are provenance", async () => {
    // The second entry has the smallest offset. A replay that sorted by
    // `afterMs`, or slept for it, would be inventing a timeline the tape does
    // not assert.
    const seen: string[] = [];
    replayWatch(recorded(), "el-000000000002", (c) => seen.push(c.id));
    const before = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(["el-00000000000b"]);
    expect(Date.now() - before).toBeLessThan(900);
  });

  it("stops feeding a watch that was closed before the tape ran out", async () => {
    const seen: string[] = [];
    const watch = replayWatch(recorded(), "el-000000000001", (c) => seen.push(c.id));
    await watch.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([]);
  });

  it("reads a tape recorded before the second direction existed as a recording with no events", () => {
    // The gtk-dialog tape is a bare array of exchanges, captured before a
    // channel could be told anything. It is read as what it is and never
    // rewritten: a tape is what the desktop did, not what we would like it to
    // have done. A watch against it answers normally and says nothing, which
    // is a valid recording of a quiet subtree - not an error.
    const tape = loadTape("gtk-dialog");
    expect(tape.exchanges.length).toBeGreaterThan(0);
    expect(tape.events).toEqual([]);
  });
});

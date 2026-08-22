import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  placementAfterMove,
  placementFile,
  readStoredPlacement,
  writeStoredPlacement,
} from "../placement-store.js";
import { restorePlacement } from "../placement.js";
import { FACE_HEIGHT, FACE_WIDTH } from "../window-model.js";

// THE WRITE PATH, WHICH NOTHING USED TO EXECUTE.
//
// ADR-0016 decision 3 says where the user put the face is where it is next
// time. Until this file existed, every test and every measurement of that
// promise exercised the RESTORE half: the geometry tests were pure functions,
// and the desk harness wrote the placement file itself and then measured that
// the widget read it back. A widget that wrote nothing on a drag, or wrote
// something unreadable, passed both rows of the exit box.
//
// The cases below drive the round trip in the direction a user does: a release
// at a position produces a file, and that file is what the next run restores
// from. The face's own writer is the thing under test, not the harness's.

let profile: string;

afterEach(() => {
  if (profile !== undefined) rmSync(profile, { recursive: true, force: true });
});

function newProfile(): string {
  profile = mkdtempSync(join(tmpdir(), "widget-placement-"));
  return profile;
}

const FACE = { width: FACE_WIDTH, height: FACE_HEIGHT };
const LEFT = { x: 0, y: 0, width: 1024, height: 768 };
const RIGHT = { x: 1024, y: 0, width: 1024, height: 768 };

/** A release, all the way through: what the widget's `moved` handler does. */
function release(dir: string, at: { x: number; y: number }, display = LEFT) {
  const bounds = { ...at, width: FACE_WIDTH, height: FACE_HEIGHT };
  const outcome = placementAfterMove(bounds, display);
  writeStoredPlacement(dir, outcome.position);
  return outcome;
}

describe("the face writes down where it was put", () => {
  it("a release in open space is on disk, and is what the next run restores", () => {
    const dir = newProfile();
    release(dir, { x: 400, y: 300 });

    // Read back through the same reader the widget uses on the next start.
    const stored = readStoredPlacement(dir);
    expect(stored).toEqual({ x: 400, y: 300 });

    const restored = restorePlacement(stored, FACE, [LEFT, RIGHT]);
    expect(restored.position).toEqual({ x: 400, y: 300 });
    expect(restored.clampedFrom).toBeUndefined();
  });

  it("writes the position the face settled at, not the one it was released at", () => {
    // A release inside the snap distance moves the face. Writing the released
    // position instead of the settled one puts the face somewhere it visibly
    // is not, one restart later.
    const dir = newProfile();
    const outcome = release(dir, { x: 8, y: 300 });
    expect(outcome.moves).toBe(true);
    expect(outcome.position.x).toBe(0);
    expect(readStoredPlacement(dir)).toEqual({ x: 0, y: 300 });
  });

  it("a release on the second output is stored with that output's coordinates", () => {
    // The cross-monitor half of decision 3. A store that keeps only a position
    // relative to one display loses which display it meant.
    const dir = newProfile();
    release(dir, { x: 1084, y: 120 }, RIGHT);
    expect(readStoredPlacement(dir)).toEqual({ x: 1084, y: 120 });
    expect(restorePlacement(readStoredPlacement(dir), FACE, [LEFT, RIGHT]).position).toEqual({
      x: 1084,
      y: 120,
    });
  });

  it("does not report a move when the release needed no snapping", () => {
    // Setting the bounds re-fires the move event, so a handler that acts on
    // every event writes the file twice for every drag that snapped.
    const dir = newProfile();
    expect(release(dir, { x: 400, y: 300 }).moves).toBe(false);
  });

  it("writes a file the reader can actually read", () => {
    // The specific way this promise fails silently: something is written on
    // every drag, and none of it is readable, so every restart opens at the
    // default and nothing anywhere says so.
    const dir = newProfile();
    release(dir, { x: 400, y: 300 });
    const raw: unknown = JSON.parse(readFileSync(placementFile(dir), "utf8"));
    expect(raw).toEqual({ x: 400, y: 300 });
  });

  it("treats a file it cannot use as no placement rather than as a position", () => {
    const dir = newProfile();
    mkdirSync(dir, { recursive: true });
    writeFileSync(placementFile(dir), JSON.stringify({ x: "over there", y: null }));
    expect(readStoredPlacement(dir)).toBeUndefined();

    writeFileSync(placementFile(dir), "not json at all");
    expect(readStoredPlacement(dir)).toBeUndefined();

    // NaN survives a JSON round trip as null, and `typeof NaN === "number"`
    // would have let a NaN through a looser check straight into setBounds.
    writeFileSync(placementFile(dir), '{"x":1e999,"y":0}');
    expect(readStoredPlacement(dir)).toBeUndefined();
  });

  it("restores nothing at all when no run has ever written a placement", () => {
    const dir = newProfile();
    expect(readStoredPlacement(dir)).toBeUndefined();
    expect(restorePlacement(undefined, FACE, [LEFT, RIGHT]).position).toEqual({ x: 40, y: 40 });
  });
});

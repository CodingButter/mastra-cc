import { describe, expect, it } from "vitest";

import { FACE_HEIGHT, FACE_WIDTH } from "../window-model.js";
import { restorePlacement, SNAP_DISTANCE, snapToEdges } from "../placement.js";

const FACE = { width: FACE_WIDTH, height: FACE_HEIGHT };

/** The two-output desk the harness measures on: 1024x768 side by side. */
const LEFT = { x: 0, y: 0, width: 1024, height: 768 };
const RIGHT = { x: 1024, y: 0, width: 1024, height: 768 };

describe("the face remembers where it was", () => {
  it("restores a position on the second display untouched", () => {
    // The half of exit box 4 that can pass on a lie: a widget persisting
    // nothing scores identical positions across a restart, as long as the
    // position it opens at is the position it was asked about. So the case
    // that matters is a NON-DEFAULT position on the SECOND display.
    const stored = { x: 1084, y: 120 };
    const restored = restorePlacement(stored, FACE, [LEFT, RIGHT]);
    expect(restored.position).toEqual(stored);
    expect(restored.clampedFrom).toBeUndefined();
  });

  it("clamps a position whose display is gone, and says so", () => {
    // The second monitor was unplugged between runs. A face restored onto a
    // display that no longer exists is invisible and unreachable.
    const stored = { x: 1084, y: 120 };
    const restored = restorePlacement(stored, FACE, [LEFT]);
    expect(restored.clampedFrom).toEqual(stored);
    expect(restored.position.x).toBeLessThanOrEqual(
      LEFT.x + LEFT.width - FACE.width,
    );
    expect(restored.position.x).toBeGreaterThanOrEqual(LEFT.x);
  });

  it("places a face that has never been placed", () => {
    const restored = restorePlacement(undefined, FACE, [LEFT, RIGHT]);
    expect(restored.clampedFrom).toBeUndefined();
    expect(restored.position.x).toBeGreaterThanOrEqual(LEFT.x);
    expect(restored.position.y).toBeGreaterThanOrEqual(LEFT.y);
  });

  it("snaps to an edge only when the face is near one", () => {
    const nearLeft = { x: 6, y: 300, ...FACE };
    expect(snapToEdges(nearLeft, LEFT).x).toBe(LEFT.x);

    // Open space is left alone. A face that snaps from anywhere is a face the
    // user cannot put where they want it.
    const middle = { x: 400, y: 300, ...FACE };
    expect(snapToEdges(middle, LEFT)).toEqual({ x: 400, y: 300 });
  });

  it("snaps to a corner when both axes are near", () => {
    const nearBottomRight = {
      x: RIGHT.x + RIGHT.width - FACE.width - SNAP_DISTANCE + 2,
      y: RIGHT.y + RIGHT.height - FACE.height - SNAP_DISTANCE + 2,
      ...FACE,
    };
    expect(snapToEdges(nearBottomRight, RIGHT)).toEqual({
      x: RIGHT.x + RIGHT.width - FACE.width,
      y: RIGHT.y + RIGHT.height - FACE.height,
    });
  });

  it("snaps against the display the face is on, not against the origin", () => {
    // A face near the right display's left edge is at x=1024, which is nowhere
    // near the desktop origin. Snapping computed against the desktop rather
    // than the display is how a face ends up jumping to another monitor.
    const nearRightDisplayLeftEdge = { x: RIGHT.x + 8, y: 300, ...FACE };
    expect(snapToEdges(nearRightDisplayLeftEdge, RIGHT).x).toBe(RIGHT.x);
  });
});

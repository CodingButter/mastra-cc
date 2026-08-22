/**
 * Where the face sits, and how that survives a restart.
 *
 * ADR-0016 decision 3: the face can be dragged anywhere, including onto another
 * monitor, it snaps to edges and corners, and where the user put it is where it
 * is next time. The prototype's face was display-sized and therefore could not
 * be dragged at all; the milestone after that got a face stuck on one monitor
 * with no way back.
 *
 * Restoring a position is the part that goes quietly wrong. A stored position
 * can name a monitor that is no longer attached, and a face restored onto a
 * display that does not exist is invisible with no way to recover it — the same
 * class of bug as the face stuck on one monitor, arrived at from the other side.
 * So restore CLAMPS onto a visible display and says that it did.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** How near an edge counts as "at" it, in pixels. */
export const SNAP_DISTANCE = 24;

export interface RestoredPlacement {
  readonly position: Point;
  /**
   * Set when the stored position could not be used as-is. The caller reports
   * it; a clamp that happens silently is a face that moved on its own.
   */
  readonly clampedFrom?: Point;
}

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Snap a face to a display's edges and corners when it is released near them.
 *
 * Only near them: a face released in open space stays exactly where it was put.
 * Each axis snaps independently, which is what makes corners fall out of edge
 * snapping rather than needing their own case.
 */
export function snapToEdges(face: Rect, display: Rect): Point {
  let { x, y } = face;

  const leftGap = Math.abs(x - display.x);
  const rightGap = Math.abs(display.x + display.width - (x + face.width));
  if (leftGap <= SNAP_DISTANCE && leftGap <= rightGap) {
    x = display.x;
  } else if (rightGap <= SNAP_DISTANCE) {
    x = display.x + display.width - face.width;
  }

  const topGap = Math.abs(y - display.y);
  const bottomGap = Math.abs(display.y + display.height - (y + face.height));
  if (topGap <= SNAP_DISTANCE && topGap <= bottomGap) {
    y = display.y;
  } else if (bottomGap <= SNAP_DISTANCE) {
    y = display.y + display.height - face.height;
  }

  return { x, y };
}

/**
 * Restore a stored position against the displays that exist now.
 *
 * A position that still lands on a display is returned untouched — including a
 * position on the second display, which is the whole point of persisting it.
 * A position on a display that is gone is clamped onto the primary display and
 * reported.
 */
export function restorePlacement(
  stored: Point | undefined,
  face: { readonly width: number; readonly height: number },
  displays: readonly Rect[],
): RestoredPlacement {
  if (displays.length === 0) {
    throw new Error("placement: cannot restore onto zero displays");
  }
  const primary = displays[0];

  if (stored === undefined) {
    return { position: { x: primary.x + 40, y: primary.y + 40 } };
  }

  const wanted: Rect = { ...stored, width: face.width, height: face.height };
  if (displays.some((d) => intersects(wanted, d))) {
    return { position: stored };
  }

  const clamped = {
    x: Math.min(
      Math.max(stored.x, primary.x),
      primary.x + primary.width - face.width,
    ),
    y: Math.min(
      Math.max(stored.y, primary.y),
      primary.y + primary.height - face.height,
    ),
  };
  return { position: clamped, clampedFrom: stored };
}

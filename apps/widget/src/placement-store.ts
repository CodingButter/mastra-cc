import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { snapToEdges, type Point, type Rect } from "./placement.js";

/**
 * The placement file: the only thing that carries where the face is from one
 * run of the widget to the next.
 *
 * WHY THIS IS ITS OWN MODULE. The reading half used to live in `main.ts` and
 * the writing half was reachable only from a `moved` handler on a real
 * BrowserWindow, which meant nothing executed it — not the unit tests, which
 * exercised pure geometry, and not the desk harness, which wrote the placement
 * file by hand and then measured that the widget could read it back. A widget
 * that wrote nothing at all, or wrote garbage, passed both of the exit box's
 * rows. The measurement was of the restore path twice.
 *
 * Nothing here imports `electron`, so both halves are reachable from a test
 * and from the harness, and the file the harness restarts against is written
 * by the code that ships rather than by the harness.
 */

export function placementFile(userDataDir: string): string {
  return join(userDataDir, "placement.json");
}

export function readStoredPlacement(userDataDir: string): Point | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(placementFile(userDataDir), "utf8"));
  } catch {
    // No file yet, on a first run, or a file that is not JSON at all. Neither
    // is worth reporting: the face opens where it opens on a first run.
    return undefined;
  }
  if (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as Point).x === "number" &&
    typeof (raw as Point).y === "number" &&
    Number.isFinite((raw as Point).x) &&
    Number.isFinite((raw as Point).y)
  ) {
    return { x: (raw as Point).x, y: (raw as Point).y };
  }
  // A placement file that exists but says nothing usable is a placement the
  // face has never had. Falling back is right; doing it silently is not.
  console.warn("widget: placement file is unreadable, opening at default");
  return undefined;
}

export function writeStoredPlacement(userDataDir: string, position: Point): void {
  const file = placementFile(userDataDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ x: position.x, y: position.y }));
}

export interface MoveOutcome {
  /** Where the face belongs now, after snapping. */
  readonly position: Point;
  /** Whether the window has to be moved to get there. */
  readonly moves: boolean;
}

/**
 * What a release at `bounds` means: where the face settles, and whether that
 * differs from where it was let go.
 *
 * `moves` exists because setting the bounds re-fires the move event: a handler
 * that writes on every event writes twice for every drag that snapped.
 */
export function placementAfterMove(bounds: Rect, display: Rect): MoveOutcome {
  const snapped = snapToEdges(bounds, display);
  return { position: snapped, moves: snapped.x !== bounds.x || snapped.y !== bounds.y };
}

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { app, BrowserWindow, screen, type Rectangle } from "electron";

import { clickableRegions, FACE_LAYOUT } from "./layout.js";
import { restorePlacement, snapToEdges, type Point } from "./placement.js";
import { FACE_HEIGHT, FACE_WIDTH, faceWindowOptions } from "./window-model.js";

/**
 * The face's main process.
 *
 * ADR-0041: a client carries a microphone, a speaker, pixels and a socket, and
 * nothing else. This file owns the pixels and the window. It holds no provider
 * credential (pin B3) and it reaches nothing over a socket of its own.
 */

function placementFile(): string {
  return join(app.getPath("userData"), "placement.json");
}

function readStoredPlacement(): Point | undefined {
  try {
    const raw = JSON.parse(readFileSync(placementFile(), "utf8")) as unknown;
    if (
      typeof raw === "object" &&
      raw !== null &&
      typeof (raw as Point).x === "number" &&
      typeof (raw as Point).y === "number"
    ) {
      return { x: (raw as Point).x, y: (raw as Point).y };
    }
    // A placement file that exists but says nothing usable is a placement the
    // face has never had. Falling back is right; doing it silently is not.
    console.warn("widget: placement file is unreadable, opening at default");
  } catch {
    // No file yet, on a first run. Not a condition worth reporting.
  }
  return undefined;
}

function writeStoredPlacement(position: Point): void {
  const file = placementFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(position));
}

function displayBounds(): Rectangle[] {
  return screen.getAllDisplays().map((d) => d.bounds);
}

export function createFace(): BrowserWindow {
  const restored = restorePlacement(
    readStoredPlacement(),
    { width: FACE_WIDTH, height: FACE_HEIGHT },
    displayBounds(),
  );
  if (restored.clampedFrom !== undefined) {
    // Decision 3, and the failure that hides itself: a face restored onto a
    // display that no longer exists is invisible with no way to recover it.
    console.warn(
      `widget: stored placement ${restored.clampedFrom.x},${restored.clampedFrom.y} is on no attached display - clamped to ${restored.position.x},${restored.position.y}`,
    );
  }

  const face = new BrowserWindow(faceWindowOptions(restored.position));

  // The face's pixels. Loading is also what makes `ready-to-show` fire - a
  // window that loads nothing never becomes ready and never appears, silently.
  void face.loadFile(join(import.meta.dirname, "face.html"));

  // Decision 2: show WITHOUT activate. `show()` and `focus()` both steal focus
  // and are forbidden in this package, enforced by a source-level test.
  //
  // Decision 4 is applied on the same beat, and it is applied to the WINDOW
  // rather than to the markup. `transparent: true` buys an alpha visual and
  // nothing more: on X11 every pixel of the rectangle still consumes clicks,
  // so a transparent corner would swallow a click meant for the window behind
  // it. `setShape` is what the X server enforces - outside the shape this
  // window is not there.
  face.once("ready-to-show", () => {
    face.setShape(clickableRegions(FACE_LAYOUT));
    face.showInactive();
  });

  // Decision 3: where the user put it is where it is next time. Snapping is
  // applied on release rather than during the drag, so the face follows the
  // pointer honestly and settles at the end.
  face.on("moved", () => {
    const bounds = face.getBounds();
    const display = screen.getDisplayMatching(bounds).bounds;
    const snapped = snapToEdges(bounds, display);
    if (snapped.x !== bounds.x || snapped.y !== bounds.y) {
      face.setBounds({ ...bounds, ...snapped });
    }
    writeStoredPlacement(snapped);
  });

  return face;
}

app.whenReady().then(() => {
  createFace();
});

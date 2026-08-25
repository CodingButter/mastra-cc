import { join } from "node:path";

import { app, BrowserWindow, ipcMain, nativeImage, screen, Tray, type Rectangle } from "electron";
import { defaultLaneSocketPath } from "@mastra-cc/transport";
import { loadWakeKeywordModel, packagedWakeModelPayload } from "@mastra-cc/voice/node";

import { connectToHub } from "./hub-connection.js";
import { createLiveWakeDetector } from "./live-wake.js";
import { captureWakeAudio } from "./wake-adapters.js";
import {
  acceptWake,
  dismissFace,
  INITIAL_FACE_STATE,
  isSpokenDismissal,
  type FaceState,
} from "./hiding-model.js";
import { clickableRegions, FACE_LAYOUT } from "./layout.js";
import { placementAfterMove, readStoredPlacement, writeStoredPlacement } from "./placement-store.js";
import { restorePlacement } from "./placement.js";
import { FACE_HEIGHT, FACE_WIDTH, faceWindowOptions } from "./window-model.js";

/**
 * The face's main process.
 *
 * ADR-0041: a client carries a microphone, a speaker, pixels and a socket, and
 * nothing else. This file owns the pixels and the window. It holds no provider
 * credential (pin B3) and it reaches nothing over a socket of its own.
 */

function displayBounds(): Rectangle[] {
  return screen.getAllDisplays().map((d) => d.bounds);
}

let state: FaceState = INITIAL_FACE_STATE;
let faceWindow: BrowserWindow | undefined;
let tray: Tray | undefined;

function render(next: FaceState): void {
  state = next;
  if (next.visible) faceWindow?.showInactive();
  else faceWindow?.hide();
  faceWindow?.webContents.send("face:state", next);
}

ipcMain.on("face:ready", () => render(state));

// THE ONE DISMISSAL PATH. The tray and M5's spoken seam both enter here.
export function dismiss(): void {
  render(dismissFace(state));
}

export function spoken(utterance: string): boolean {
  if (!isSpokenDismissal(utterance)) return false;
  dismiss();
  return true;
}

// The live desk harness cannot synthesize a tray click without introducing raw
// input outside the daemon. SIGUSR1 enters the exact dismissal function instead,
// while the source-shape test proves the tray and spoken seam bind to it too.
process.on("SIGUSR1", dismiss);

function trayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#38bdf8"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

export function createFace(): BrowserWindow {
  const profile = app.getPath("userData");
  const restored = restorePlacement(
    readStoredPlacement(profile),
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

  const face = new BrowserWindow({
    ...faceWindowOptions(restored.position),
    webPreferences: { preload: join(import.meta.dirname, "preload.cjs") },
  });
  faceWindow = face;

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
    render(state);
  });

  // Decision 3: where the user put it is where it is next time. The window
  // reports each settled move; edge snapping may cause one final moved event.
  face.on("moved", () => {
    const bounds = face.getBounds();
    const display = screen.getDisplayMatching(bounds).bounds;
    const { position, moves } = placementAfterMove(bounds, display);
    if (moves) {
      // Which re-fires this event. The second pass finds nothing to snap and
      // writes the same bytes again, so a snapped drag costs two writes of an
      // identical file. That is the deliberate half of the trade: skipping the
      // first write instead would leave the placement unrecorded if the
      // re-fire ever failed to arrive, and an unrecorded placement is the
      // failure decision 3 exists to prevent.
      face.setBounds({ ...bounds, ...position });
    }
    writeStoredPlacement(profile, position);
  });

  return face;
}

app.whenReady().then(async () => {
  createFace();

  tray = new Tray(trayIcon());
  tray.setToolTip("Mastra face");
  tray.on("click", dismiss);

  try {
    const model = await loadWakeKeywordModel(packagedWakeModelPayload());
    let detector: ReturnType<typeof createLiveWakeDetector> | undefined;
    const hub = await connectToHub({
      socketPath: defaultLaneSocketPath(),
      onState: (next) => {
        render(next);
        detector?.sessionStateChanged();
      },
    });
    detector = createLiveWakeDetector({
      capture: captureWakeAudio,
      model,
      state: () => state,
      onDecision: (result) => console.log(JSON.stringify({ type: "wake-decision", pid: process.pid, at: new Date().toISOString(), ...result })),
      onAccept: () => {
        render(acceptWake(state));
        hub.said();
      },
    });
    let wakeTimer: NodeJS.Timeout | undefined;
    let quitting = false;
    const pumpWake = async () => {
      await detector?.runOnce();
      if (quitting) return;
      wakeTimer = setTimeout(() => void pumpWake(), 250);
      wakeTimer.unref();
    };
    void pumpWake();
    app.once("before-quit", () => {
      quitting = true;
      if (wakeTimer !== undefined) clearTimeout(wakeTimer);
      detector?.stop();
    });
  } catch (error) {
    console.warn(error instanceof Error ? error.message : String(error));
  }
});

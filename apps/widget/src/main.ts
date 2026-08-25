import { join } from "node:path";

import { app, BrowserWindow, ipcMain, nativeImage, screen, Tray, type IpcMainEvent, type Rectangle } from "electron";
import { defaultLaneSocketPath } from "@mastra-cc/transport";
import { loadWakeKeywordModel, packagedWakeModelPayload } from "@mastra-cc/voice/node";

import { connectToHub } from "./hub-connection.js";
import { createLiveWakeDetector } from "./live-wake.js";
import { admitOpening } from "./voice/admission.js";
import { createActiveVoiceSession } from "./voice/active-session.js";
import { createMicrophoneSource, createProviderSession } from "./voice/provider-session.js";
import { createSignalScheduler } from "./voice/signal-scheduler.js";
import { advanceSpeechActivity, createSpeechActivityState } from "./voice/speech-activity.js";
import {
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
let closeVoiceSession = () => {};

function render(next: FaceState): void {
  state = next;
  if (next.visible) faceWindow?.showInactive();
  else faceWindow?.hide();
  faceWindow?.webContents.send("face:state", next);
}

ipcMain.on("face:ready", () => render(state));

// THE ONE DISMISSAL PATH. The tray and M5's spoken seam both enter here.
export function dismiss(): void {
  closeVoiceSession();
  render(dismissFace({ ...state, voiceOpen: false, microphoneGateOpen: false }));
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
  face.webContents.session.setPermissionCheckHandler((_webContents, permission) => permission === "media");
  face.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === "media"));

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
    let scheduler: ReturnType<typeof createSignalScheduler> | undefined;
    let handleHubVoiceClosed = () => {};
    const hub = await connectToHub({
      socketPath: defaultLaneSocketPath(),
      onState: render,
      onVoiceClosed: () => handleHubVoiceClosed(),
      onSignal: (signal) => scheduler?.enqueue(signal),
    });
    const microphoneSource = createMicrophoneSource();
    let detector: ReturnType<typeof createLiveWakeDetector>;
    let provider: ReturnType<typeof createProviderSession>;
    const conversation = createActiveVoiceSession({
      said: hub.said,
      openHubSession: hub.openVoiceSession,
      closeHubSession: hub.closeVoiceSession,
      closeProvider: () => {
        faceWindow?.webContents.send("face:provider-audio-stopped");
        provider.close();
      },
      resetWake: () => detector?.discard("session-closed"),
    });
    handleHubVoiceClosed = conversation.hubClosed;
    provider = createProviderSession({
      onAudio: (chunk) => faceWindow?.webContents.send("face:provider-audio", chunk),
      onInputTranscript: (text) => {
        if (isSpokenDismissal(text)) {
          console.log(JSON.stringify({ type: "voice-session", pid: process.pid, at: new Date().toISOString(), event: "dismissal", source: "input-transcript" }));
        }
        spoken(text);
      },
      onModelSpeechStarted: () => scheduler?.modelSpeechStarted(),
      onModelSpeechFinished: () => scheduler?.modelSpeechFinished(),
      onAdmitted: () => {
        console.log(JSON.stringify({ type: "provider-session", pid: process.pid, at: new Date().toISOString(), event: "admitted" }));
        detector.admit("realtime-admitted");
        conversation.admit();
      },
      onStopListening: () => {
        console.log(JSON.stringify({ type: "voice-session", pid: process.pid, at: new Date().toISOString(), event: "dismissal", source: "provider-control" }));
        spoken("stop");
      },
      onTerminalDecision: (reason) => {
        console.log(JSON.stringify({ type: "provider-session", pid: process.pid, at: new Date().toISOString(), event: "terminal-decision", reason }));
      },
      onClosed: () => {
        console.log(JSON.stringify({ type: "provider-session", pid: process.pid, at: new Date().toISOString(), event: "closed" }));
        conversation.close(conversation.state() === "active" ? "active" : "provisional");
      },
    });
    scheduler = createSignalScheduler({ deliver: (batch) => provider.sendSignals(batch) });
    closeVoiceSession = () => conversation.close(conversation.state() === "active" ? "active" : "provisional");
    const controller = new AbortController();
    detector = createLiveWakeDetector({
      model,
      state: () => state,
      onDecision: (result) => console.log(JSON.stringify({ type: "wake-decision", pid: process.pid, at: new Date().toISOString(), ...result })),
      onMetadata: (metadata) => {
        console.log(JSON.stringify({ type: "provisional-listening", pid: process.pid, at: new Date().toISOString(), ...metadata }));
        if (metadata.state === "capturing-opening") render({ ...state, visible: true, caption: "Listening — speak naturally" });
        else if (metadata.state === "awaiting-admission") render({ ...state, visible: true, caption: "Captured — listening" });
        else if (metadata.state === "admitted") render({ ...state, visible: true, voiceOpen: true, microphoneGateOpen: true, caption: undefined });
      },
      onOpening: (opening) => {
        void admitOpening({
          opening,
          hub,
          detector,
          provider,
          microphone: microphoneSource,
          signal: controller.signal,
        }).catch((error) => {
          detector.discard("admission-failed");
          console.warn(error instanceof Error ? error.message : String(error));
        });
      },
    });
    let speechActivity = createSpeechActivityState();
    const onMicrophone = (_event: IpcMainEvent, payload: unknown) => {
      const samples = payload instanceof ArrayBuffer
        ? new Int16Array(payload)
        : ArrayBuffer.isView(payload)
          ? new Int16Array(payload.buffer, payload.byteOffset, Math.floor(payload.byteLength / 2))
          : undefined;
      if (!samples || samples.byteLength === 0 || samples.byteLength > 640 || samples.byteLength % 2 !== 0) return;
      detector.acceptSamples(samples);
      microphoneSource.push(samples);
      if (conversation.state() === "active") {
        const activity = advanceSpeechActivity(speechActivity, samples);
        speechActivity = activity.state;
        if (activity.onset) {
          conversation.heard("speech");
          scheduler?.userTurn();
        }
      } else {
        speechActivity = createSpeechActivityState();
      }
    };
    const onMicrophoneFailed = (_event: IpcMainEvent, message: unknown) => {
      detector.captureFailed();
      console.warn(`widget: Chromium microphone failed - ${String(message)}`);
    };
    ipcMain.on("face:microphone", onMicrophone);
    ipcMain.on("face:microphone-failed", onMicrophoneFailed);
    app.once("before-quit", () => {
      controller.abort();
      ipcMain.removeListener("face:microphone", onMicrophone);
      ipcMain.removeListener("face:microphone-failed", onMicrophoneFailed);
      detector.stop();
      provider.close();
      scheduler?.close();
      void hub.close();
    });
  } catch (error) {
    console.warn(error instanceof Error ? error.message : String(error));
  }
});

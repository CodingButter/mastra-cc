/**
 * The renderer. It paints the face at the coordinates layout.ts owns.
 *
 * ADR-0041: a client carries a microphone, a speaker, pixels and a socket, and
 * nothing else. This file is the pixels. It reaches nothing — the socket is the
 * main process's, and arrives in Segment 2.
 */

import type { FaceState } from "./hiding-model.js";
import { FACE_LAYOUT, layoutCss } from "./layout.js";
import { startRendererAudio, type FaceAudioBridge } from "./renderer-audio.js";

declare global {
  interface Window {
    mastraFace: FaceAudioBridge & { onState(listener: (state: FaceState) => void): void };
  }
}

const style = document.createElement("style");
style.textContent = layoutCss(FACE_LAYOUT);
document.head.appendChild(style);

window.mastraFace.onState((state) => {
  document.querySelector("#caption")!.textContent = state.caption ?? "";
});

void startRendererAudio(window.mastraFace)
  .then((close) => window.addEventListener("pagehide", () => void close(), { once: true }))
  .catch((error) => {
    window.mastraFace.microphoneFailed(error instanceof Error ? error.message : String(error));
  });

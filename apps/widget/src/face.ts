/**
 * The renderer. It paints the face at the coordinates layout.ts owns.
 *
 * ADR-0041: a client carries a microphone, a speaker, pixels and a socket, and
 * nothing else. This file is the pixels. It reaches nothing — the socket is the
 * main process's, and arrives in Segment 2.
 */

import { FACE_LAYOUT, layoutCss } from "./layout.js";

const style = document.createElement("style");
style.textContent = layoutCss(FACE_LAYOUT);
document.head.appendChild(style);

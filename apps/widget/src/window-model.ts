/**
 * The face's window options, as a value.
 *
 * ADR-0016 decision 1: the face is a window the window manager manages. The
 * prototype got this wrong by asking for an unfocusable window, which made
 * Electron create an override-redirect window, which took it out of the window
 * manager's control entirely — so `_NET_WM_STATE_ABOVE` was silently discarded
 * and "always on top" degraded into raw stacking order. Nothing failed; it just
 * stopped being true.
 *
 * The guarantee therefore lives in what is ABSENT here as much as in what is
 * present, and absence is hard to test. So the options are built as a plain
 * object by a pure function, and the test asserts against the object the
 * application will actually pass to Electron rather than against a comment
 * promising it.
 */

/** The face's fixed size. Decision 3: face-sized, never display-sized. */
export const FACE_WIDTH = 220;
export const FACE_HEIGHT = 220;

export interface FaceWindowOptions {
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  readonly frame: false;
  readonly transparent: true;
  readonly resizable: false;
  readonly alwaysOnTop: true;
  readonly skipTaskbar: true;
  /**
   * Never `show: true`. The only path onto the screen is `showInactive()`
   * (decision 2), and a window that shows itself at construction has taken a
   * different path.
   */
  readonly show: false;
  readonly title: string;
}

/**
 * Build the face's window options.
 *
 * `focusable` is deliberately not set. Electron's default is a focusable,
 * window-manager-managed window, which is exactly what decision 1 requires;
 * setting `focusable: false` is the one-word edit that reintroduces the
 * prototype's bug, and nothing else in the build would notice.
 */
export function faceWindowOptions(position: {
  readonly x: number;
  readonly y: number;
}): FaceWindowOptions {
  return {
    width: FACE_WIDTH,
    height: FACE_HEIGHT,
    x: position.x,
    y: position.y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: "mastra-face",
  };
}

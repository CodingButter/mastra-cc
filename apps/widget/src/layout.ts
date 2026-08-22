/**
 * The face's layout, and the clickable shape derived from it.
 *
 * ADR-0016 decision 4: clicks land on the orb, the caption and the menu;
 * anywhere else in the rectangle they pass straight through to whatever is
 * behind. ADR-0016's Consequences section warns that shaped click-through
 * "has to be re-verified whenever the face's visual layout changes" — so the
 * geometry is declared ONCE, here, and everything else is derived from it:
 * the X11 input shape the window manager enforces, the hit test the tests
 * assert against, and the CSS the renderer paints with.
 *
 * Two hand-maintained copies of this geometry is precisely how that warning
 * comes true, so there are none. A layout change moves the painted pixels, the
 * shape and the hit test together or it moves none of them.
 *
 * WHY BANDS. The orb is a circle and `BrowserWindow.setShape` takes
 * rectangles, so the circle reaches X as a stack of horizontal bands. The hit
 * test deliberately runs against those same bands rather than against the
 * ideal circle: X enforces the bands, and a test that asserted the ideal
 * circle would disagree with the desktop at the edges and be wrong in the
 * direction that looks right.
 */

import type { Rect } from "./placement.js";

export interface Circle {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

export interface FaceLayout {
  readonly orb: Circle;
  readonly caption: Rect;
  readonly menu: Rect;
}

/** How finely the orb's circle is approximated, in pixels per band. */
export const BAND_HEIGHT = 4;

export const FACE_LAYOUT: FaceLayout = {
  orb: { cx: 110, cy: 90, r: 70 },
  caption: { x: 10, y: 168, width: 200, height: 22 },
  menu: { x: 186, y: 4, width: 30, height: 30 },
};

/**
 * The regions of the face that take clicks.
 *
 * This is the value handed to `BrowserWindow.setShape`, which on X11 becomes
 * the window's shape: a pointer event outside it is not delivered to this
 * window at all, it goes to whatever is underneath. That is the guarantee —
 * not a renderer that ignores clicks it does not like, but a window the X
 * server does not consider present at those coordinates.
 */
export function clickableRegions(layout: FaceLayout): Rect[] {
  const regions: Rect[] = [];

  const { cx, cy, r } = layout.orb;
  for (let top = cy - r; top < cy + r; top += BAND_HEIGHT) {
    const bottom = Math.min(top + BAND_HEIGHT, cy + r);
    // The band is as wide as the circle at whichever of its two edges is
    // nearer the centre — the inscribed width. An overestimate would hand X a
    // shape wider than the painted orb, and clicks would land on nothing
    // visible.
    const nearest = top >= cy ? top : bottom;
    const dy = Math.abs(nearest - cy);
    if (dy >= r) continue;
    const halfWidth = Math.sqrt(r * r - dy * dy);
    regions.push({
      x: Math.round(cx - halfWidth),
      y: top,
      width: Math.round(halfWidth * 2),
      height: bottom - top,
    });
  }

  regions.push(layout.caption);
  regions.push(layout.menu);
  return regions;
}

/** Whether a point inside the face's rectangle lands on something clickable. */
export function hitsFace(
  point: { readonly x: number; readonly y: number },
  regions: readonly Rect[],
): boolean {
  return regions.some(
    (region) =>
      point.x >= region.x &&
      point.x < region.x + region.width &&
      point.y >= region.y &&
      point.y < region.y + region.height,
  );
}

/**
 * The renderer's geometry, generated from the same layout.
 *
 * The markup in `face.html` carries structure and colour and no coordinates,
 * because a coordinate written there would be the second copy this file exists
 * to prevent.
 */
export function layoutCss(layout: FaceLayout): string {
  const { orb, caption, menu } = layout;
  return [
    `#orb { position: absolute; left: ${orb.cx - orb.r}px; top: ${orb.cy - orb.r}px;`,
    ` width: ${orb.r * 2}px; height: ${orb.r * 2}px; border-radius: 50%; }`,
    `#caption { position: absolute; left: ${caption.x}px; top: ${caption.y}px;`,
    ` width: ${caption.width}px; height: ${caption.height}px; }`,
    `#menu { position: absolute; left: ${menu.x}px; top: ${menu.y}px;`,
    ` width: ${menu.width}px; height: ${menu.height}px; }`,
  ].join("");
}

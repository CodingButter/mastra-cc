import { describe, expect, it } from "vitest";

import {
  clickableRegions,
  hitsFace,
  layoutCss,
  FACE_LAYOUT,
  type FaceLayout,
} from "../layout.js";
import { FACE_HEIGHT, FACE_WIDTH } from "../window-model.js";

/**
 * ADR-0016 decision 4. The Consequences section names this file's subject
 * directly: shaped click-through "is covered by tests that assert clicks in
 * transparent regions send nothing".
 *
 * The shape shipped to X is a list of rectangles, and these tests run against
 * the same list rather than against the ideal circle — see layout.ts for why
 * agreeing with X matters more than agreeing with the geometry.
 */

const REGIONS = clickableRegions(FACE_LAYOUT);

describe("clicks land only on the face", () => {
  it("hits a point on the orb", () => {
    const { cx, cy } = FACE_LAYOUT.orb;
    expect(hitsFace({ x: cx, y: cy }, REGIONS)).toBe(true);
    expect(hitsFace({ x: cx, y: cy - FACE_LAYOUT.orb.r + 6 }, REGIONS)).toBe(
      true,
    );
  });

  it("misses a point in the transparent region", () => {
    // The corners of the rectangle are the clearest case: far from the orb,
    // far from the caption, far from the menu. A shape that has quietly become
    // the whole rectangle fails here and nowhere else.
    expect(hitsFace({ x: 2, y: 2 }, REGIONS)).toBe(false);
    expect(hitsFace({ x: FACE_WIDTH - 3, y: FACE_HEIGHT - 3 }, REGIONS)).toBe(
      false,
    );
    expect(hitsFace({ x: 4, y: FACE_HEIGHT - 4 }, REGIONS)).toBe(false);

    // And the corner of the orb's bounding box, which is inside the square the
    // orb occupies but outside the circle actually painted there.
    const { cx, cy, r } = FACE_LAYOUT.orb;
    expect(hitsFace({ x: cx - r + 2, y: cy - r + 2 }, REGIONS)).toBe(false);
  });

  it("hits the caption and the menu", () => {
    const { caption, menu } = FACE_LAYOUT;
    expect(
      hitsFace(
        { x: caption.x + caption.width / 2, y: caption.y + caption.height / 2 },
        REGIONS,
      ),
    ).toBe(true);
    expect(
      hitsFace({ x: menu.x + menu.width / 2, y: menu.y + menu.height / 2 }, REGIONS),
    ).toBe(true);
  });

  it("moves its hit regions when the layout moves", () => {
    // The assertion that the regions are DERIVED. Asserted by changing the
    // layout and observing the regions follow, rather than by reading a
    // constant back — a hard-coded shape passes every test above.
    // The moved orb's centre must land OUTSIDE the shipped orb, or the test
    // passes on an overlap rather than on the derivation. (110,90) r=70 covers
    // (60,60); (40,40) it does not.
    const moved: FaceLayout = {
      ...FACE_LAYOUT,
      orb: { cx: 40, cy: 40, r: 30 },
    };
    const movedRegions = clickableRegions(moved);

    expect(hitsFace({ x: 40, y: 40 }, movedRegions)).toBe(true);
    expect(hitsFace({ x: 40, y: 40 }, REGIONS)).toBe(false);
    expect(hitsFace({ x: FACE_LAYOUT.orb.cx, y: FACE_LAYOUT.orb.cy }, movedRegions)).toBe(
      false,
    );
  });

  it("keeps every clickable region inside the face's rectangle", () => {
    // A region outside the window is a region X will never deliver a click to,
    // and it would make the shape look larger than it is.
    for (const region of REGIONS) {
      expect(region.x).toBeGreaterThanOrEqual(0);
      expect(region.y).toBeGreaterThanOrEqual(0);
      expect(region.x + region.width).toBeLessThanOrEqual(FACE_WIDTH);
      expect(region.y + region.height).toBeLessThanOrEqual(FACE_HEIGHT);
      expect(region.width).toBeGreaterThan(0);
      expect(region.height).toBeGreaterThan(0);
    }
    // And the shape must not be the whole rectangle by area, which is the
    // failure mode that keeps every other assertion here green.
    const area = REGIONS.reduce((sum, r) => sum + r.width * r.height, 0);
    expect(area).toBeLessThan(FACE_WIDTH * FACE_HEIGHT * 0.6);
  });

  it("paints the orb where the shape says it is clickable", () => {
    // The renderer's coordinates come from the same layout, so the painted
    // pixels and the input shape cannot drift apart. If face.html ever grows a
    // coordinate of its own, this stops being true and nothing else notices.
    const css = layoutCss(FACE_LAYOUT);
    const { orb } = FACE_LAYOUT;
    expect(css).toContain(`left: ${orb.cx - orb.r}px`);
    expect(css).toContain(`width: ${orb.r * 2}px`);
    expect(layoutCss({ ...FACE_LAYOUT, orb: { cx: 40, cy: 40, r: 30 } })).toContain(
      "left: 10px",
    );
  });
});

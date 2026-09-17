// WHERE IN THE ELEMENT A PICTURE POINTS. A captured image may be less than the
// whole element (ADR-0105), and then the middle of the picture is not the
// middle of the element. The daemon says where the picture lies as a crop in
// element fractions; this is the one place the arithmetic from picture
// location to element fraction is written down, so a caller does not do it
// by hand and a model does not do it in its head.
//
// It REFUSES rather than clamps. A location outside the picture, or a crop
// the daemon could not have sent, is a sign the caller is holding the wrong
// numbers, and a clamped click is a click on a neighbour with a clean log.

import type { CapturedImage } from "@mastra-cc/protocol-types";

export interface ElementLocation {
  /** Fraction of the element's width from its left edge - what clickElement takes as x. */
  x: number;
  /** Fraction of the element's height from its top edge - what clickElement takes as y. */
  y: number;
}

export class CaptureGeometryError extends Error {}

function unit(value: number, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new CaptureGeometryError(`${what} must be a finite number from 0 through 1, not ${String(value)}`);
  }
  return value;
}

/** Check a crop is one the daemon could have sent: every side within 0..1 and
 *  the rectangle inside the element. Exported so a consumer that receives a
 *  picture from somewhere other than the daemon can hold it to the same rule. */
export function validateCrop(crop: CapturedImage["crop"]): CapturedImage["crop"] {
  if (crop === null || typeof crop !== "object") throw new CaptureGeometryError("a capture crop must be an object");
  const x = unit(crop.x, "crop.x");
  const y = unit(crop.y, "crop.y");
  const width = unit(crop.width, "crop.width");
  const height = unit(crop.height, "crop.height");
  if (width === 0 || height === 0) throw new CaptureGeometryError("a capture crop cannot have zero width or height - that is a picture of nothing");
  if (x + width > 1 || y + height > 1) {
    throw new CaptureGeometryError(`a capture crop must lie inside the element; ${x} + ${width} or ${y} + ${height} exceeds 1`);
  }
  return { x, y, width, height };
}

/**
 * Map a location inside a picture to the element fractions clickElement takes.
 * `u` and `v` are fractions of the picture's own width and height, 0 through 1.
 *
 * This is a capture-time relationship. It says where that point of the picture
 * was in the element when the pixels were read; it does not say the element is
 * still there. Resolve the element again before pressing.
 */
export function locateInElement(image: Pick<CapturedImage, "crop">, u: number, v: number): ElementLocation {
  const crop = validateCrop(image.crop);
  const pu = unit(u, "picture location u");
  const pv = unit(v, "picture location v");
  return { x: crop.x + pu * crop.width, y: crop.y + pv * crop.height };
}

/** The sentence a model reads next to the picture: what it is a picture of,
 *  whether it is all of the element, and how to turn a place in it into a
 *  click. Kept short and exact; the numbers are the daemon's, not rounded. */
export function describeCapture(image: Omit<CapturedImage, "data">): string {
  const { crop } = image;
  const extent = image.clipped
    ? `CLIPPED: it shows only the part of the element from x ${crop.x} to ${crop.x + crop.width} and y ${crop.y} to ${crop.y + crop.height} (fractions of the element)`
    : "the whole element (crop 0,0 to 1,1)";
  return (
    `${image.width} by ${image.height} pixel picture of ${extent}. ` +
    `Source: visible desktop pixels; other windows may be drawn over the element and occlusion is not established. ` +
    `A location (u, v) in this picture, each 0 through 1, is at element fraction ` +
    `x = ${crop.x} + u * ${crop.width}, y = ${crop.y} + v * ${crop.height} - the x and y clickElement takes. ` +
    `Captured at ${image.capturedAt} ms; resolve the element again before acting on it.`
  );
}

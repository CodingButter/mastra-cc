// A PLACE IN THE PICTURE IS A PLACE IN THE ELEMENT - once, and only through
// the crop the daemon sent (ADR-0105). A clipped picture's centre is not the
// element's centre; the arithmetic that says where it IS lives in one helper,
// and the helper refuses numbers that cannot be right rather than clamping
// them into a click on something else.

import { describe, expect, it } from "vitest";
import { CaptureGeometryError, describeCapture, locateInElement, validateCrop } from "../capture-geometry.js";

const whole = { crop: { x: 0, y: 0, width: 1, height: 1 } };
const rightHalf = { crop: { x: 0.5, y: 0, width: 0.5, height: 1 } };
const bottomThird = { crop: { x: 0, y: 2 / 3, width: 1, height: 1 / 3 } };
const inner = { crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } };

describe("locateInElement", () => {
  it("leaves a whole picture's locations alone", () => {
    expect(locateInElement(whole, 0.5, 0.5)).toEqual({ x: 0.5, y: 0.5 });
    expect(locateInElement(whole, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(locateInElement(whole, 1, 1)).toEqual({ x: 1, y: 1 });
  });

  it("puts the centre of the right half at three quarters, which is the whole reason this exists", () => {
    expect(locateInElement(rightHalf, 0.5, 0.5)).toEqual({ x: 0.75, y: 0.5 });
    expect(locateInElement(rightHalf, 0, 0)).toEqual({ x: 0.5, y: 0 });
    expect(locateInElement(rightHalf, 1, 1)).toEqual({ x: 1, y: 1 });
  });

  it("carries fractional crops without rounding them", () => {
    const { x, y } = locateInElement(bottomThird, 0.5, 0.5);
    expect(x).toBe(0.5);
    expect(y).toBeCloseTo(2 / 3 + 0.5 / 3, 12);
    expect(locateInElement(inner, 0.5, 0.5)).toEqual({ x: 0.5, y: 0.5 });
    expect(locateInElement(inner, 1, 0)).toEqual({ x: 0.75, y: 0.25 });
  });

  it.each([
    [-0.01, 0.5], [1.01, 0.5], [0.5, -1], [0.5, 2], [Number.NaN, 0.5], [0.5, Number.POSITIVE_INFINITY],
  ])("refuses a picture location outside the picture rather than clamping it: %s, %s", (u, v) => {
    expect(() => locateInElement(whole, u, v)).toThrow(CaptureGeometryError);
    expect(() => locateInElement(rightHalf, u, v)).toThrow(CaptureGeometryError);
  });

  it.each([
    { x: -0.1, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 1 },
    { x: 0, y: 0, width: 1, height: 0 },
    { x: 0.6, y: 0, width: 0.5, height: 1 },
    { x: 0, y: 0.5, width: 1, height: 0.6 },
    { x: Number.NaN, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 1 },
  ])("refuses a crop the daemon could not have sent: %j", (crop) => {
    expect(() => validateCrop(crop)).toThrow(CaptureGeometryError);
    expect(() => locateInElement({ crop }, 0.5, 0.5)).toThrow(CaptureGeometryError);
  });
});

describe("describeCapture", () => {
  const base = { format: "png" as const, width: 40, height: 30, source: "visible-desktop" as const, capturedAt: 5 };
  it("says a whole picture is whole and a clipped one is clipped, with the mapping in both", () => {
    const wholeText = describeCapture({ ...base, clipped: false, ...whole });
    expect(wholeText).toContain("the whole element");
    expect(wholeText).toContain("x = 0 + u * 1");
    const clippedText = describeCapture({ ...base, clipped: true, ...rightHalf });
    expect(clippedText).toContain("CLIPPED");
    expect(clippedText).toContain("x 0.5 to 1");
    expect(clippedText).toContain("y = 0 + v * 1");
    expect(clippedText).toContain("occlusion is not established");
    expect(clippedText).toContain("resolve the element again");
  });
});

// WHAT A PICTURE MAY AND MAY NOT BE. Three properties are worth pinning here,
// and they are the three that make the difference between a photograph of a
// named thing and a screen recording wearing a smaller name.
//
// The first is the CROP: a rectangle asked for in the desk's coordinates,
// answered out of a dump that begins wherever its window begins. Get the origin
// arithmetic wrong and every picture is of the wrong thing while every
// dimension in the answer is right, which is the worst kind of wrong - it looks
// correct in a log.
//
// The second is the ENCODE: bytes another program can open. A test that only
// checked the length would pass on a buffer of noise, so the PNG here is read
// back through zlib and compared to the pixels that went in.
//
// The third is the REFUSAL: a rectangle with nothing behind it is said to be
// empty rather than answered with a picture of somewhere else.

import { describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";

vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
import { inflateSync } from "node:zlib";
import { capture, CaptureFailedError, cropScreen, decodeXwd, encodePng, grabPixels, run } from "../backends/atspi/capture.js";

/** An XWD dump the way an X server writes one: big-endian header, ZPixmap,
 *  32 bits a pixel, little-endian bytes, placed at an origin. */
function dump(options: {
  width: number;
  height: number;
  originX: number;
  originY: number;
  pixel: (x: number, y: number) => [number, number, number];
}): Buffer {
  const header = Buffer.alloc(100);
  const words = [100, 7, 2, 24, options.width, options.height, 0, 0, 32, 0, 32, 32, options.width * 4, 4, 0xff0000, 0xff00, 0xff, 8, 256, 0, options.width, options.height, options.originX, options.originY, 0];
  words.forEach((word, index) => header.writeUInt32BE(word >>> 0, index * 4));
  const body = Buffer.alloc(options.width * options.height * 4);
  for (let y = 0; y < options.height; y += 1) {
    for (let x = 0; x < options.width; x += 1) {
      const [r, g, b] = options.pixel(x, y);
      const at = (y * options.width + x) * 4;
      body[at] = b;
      body[at + 1] = g;
      body[at + 2] = r;
    }
  }
  return Buffer.concat([header, body]);
}

/** Undo the PNG this module writes, so the assertion is about pixels rather
 *  than about byte counts. */
function readPng(png: Buffer): { width: number; height: number; at: (x: number, y: number) => [number, number, number] } {
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  let offset = 8;
  let pixels = Buffer.alloc(0);
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") pixels = inflateSync(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  return {
    width,
    height,
    at: (x, y) => {
      const row = y * (width * 3 + 1) + 1;
      return [pixels[row + x * 3], pixels[row + x * 3 + 1], pixels[row + x * 3 + 2]];
    },
  };
}

describe("a picture crops the visible desktop at the named element's rectangle", () => {
  it("reads a linear DirectColor palette and refuses non-linear or incomplete palettes", () => {
    const original = dump({ width: 1, height: 1, originX: 0, originY: 0, pixel: () => [10, 20, 30] });
    const palette = Buffer.alloc(256 * 12);
    for (let i = 0; i < 256; i += 1) {
      palette.writeUInt32BE(i * 0x010101, i * 12);
      for (const offset of [4, 6, 8]) palette.writeUInt16BE(i * 257, i * 12 + offset);
    }
    const data = Buffer.concat([original.subarray(0, 100), palette, original.subarray(100)]);
    data.writeUInt32BE(5, 13 * 4);
    data.writeUInt32BE(256, 19 * 4);
    expect([...decodeXwd(data).pixels]).toEqual([10, 20, 30]);
    data.writeUInt16BE(0, 100 + 10 * 12 + 4);
    expect(() => decodeXwd(data)).toThrow("non-linear DirectColor");
    data.writeUInt32BE(255, 19 * 4);
    expect(() => decodeXwd(data)).toThrow("unsupported DirectColor palette");
  });
  it("reads an X dump back as the colours that were put into it, in the right order", () => {
    const screen = decodeXwd(dump({ width: 2, height: 1, originX: 0, originY: 0, pixel: () => [10, 20, 30] }));
    expect(screen.width).toBe(2);
    expect([screen.pixels[0], screen.pixels[1], screen.pixels[2]]).toEqual([10, 20, 30]);
  });

  it("cuts the rectangle out at the desk's coordinates, not at the window's", async () => {
    // A window that begins at (100, 50), each pixel coloured by where it sits
    // ON THE DESK. A crop that ignored the origin would come back the right
    // size and the wrong place, so the colours are the assertion.
    const grabbed = dump({
      width: 40,
      height: 40,
      originX: 100,
      originY: 50,
      pixel: (x, y) => [(100 + x) % 256, (50 + y) % 256, 0],
    });
    const shot = await capture({ x: 110, y: 60, width: 4, height: 3 }, async () => grabbed);
    expect([shot.width, shot.height]).toEqual([4, 3]);
    const png = readPng(Buffer.from(shot.data, "base64"));
    expect(png.at(0, 0)).toEqual([110, 60, 0]);
    expect(png.at(3, 2)).toEqual([113, 62, 0]);
  });

  it("answers with a whole window when no rectangle was asked for", async () => {
    const shot = await capture(undefined, async () => dump({ width: 3, height: 2, originX: 0, originY: 0, pixel: () => [1, 2, 3] }));
    expect([shot.width, shot.height, shot.format]).toEqual([3, 2, "png"]);
  });

  it("refuses a rectangle the grabbed pixels do not cover, rather than answering with somewhere else", () => {
    const screen = decodeXwd(dump({ width: 4, height: 4, originX: 0, originY: 0, pixel: () => [0, 0, 0] }));
    expect(() => cropScreen(screen, { x: 900, y: 900, width: 10, height: 10 })).toThrow(CaptureFailedError);
  });

  it("refuses a pixel format it cannot read instead of guessing at the bytes", () => {
    const wrong = dump({ width: 1, height: 1, originX: 0, originY: 0, pixel: () => [0, 0, 0] });
    wrong.writeUInt32BE(11, 11 * 4); // eleven bits a pixel: not a thing this reads
    expect(() => decodeXwd(wrong)).toThrow(/11 bits a pixel/);
  });

  it("writes a PNG whose header says what the picture actually is", () => {
    const png = encodePng({ width: 5, height: 3, originX: 0, originY: 0, pixels: Buffer.alloc(45, 7) });
    expect(png.readUInt32BE(16)).toBe(5);
    expect(png.readUInt32BE(20)).toBe(3);
    expect(png[24]).toBe(8); // eight bits a channel
    expect(png[25]).toBe(2); // truecolour
  });

  it("reads the root desktop and crops its visible pixels, including an overlapping window", async () => {
    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const desktop = dump({ width: 4, height: 3, originX: 0, originY: 0,
      pixel: (x, y) => x === 2 && y === 1 ? [255, 0, 0] : [0, 0, 255] });
    vi.mocked(spawn).mockClear();
    vi.mocked(spawn).mockImplementationOnce(() => actual.spawn(process.execPath,
      ["-e", `process.stdout.write(Buffer.from('${desktop.toString("base64")}', 'base64'))`],
      { stdio: ["ignore", "pipe", "pipe"] }));
    const shot = await capture({ x: 1, y: 1, width: 2, height: 1 });
    expect(spawn).toHaveBeenCalledExactlyOnceWith("xwd", ["-root", "-silent"], { stdio: ["ignore", "pipe", "pipe"] });
    const png = readPng(Buffer.from(shot.data, "base64"));
    expect([png.width, png.height]).toEqual([2, 1]);
    expect(png.at(0, 0)).toEqual([0, 0, 255]);
    expect(png.at(1, 0)).toEqual([255, 0, 0]);
  });

  it.each([
    { x: NaN, y: 0, width: 1, height: 1 },
    { x: 0, y: Infinity, width: 1, height: 1 },
    { x: 0.5, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 1 },
    { x: 0, y: 0, width: 1, height: -1 },
    { x: Number.MAX_SAFE_INTEGER, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 16777217, height: 1 },
  ])("refuses invalid geometry before any pixel read: %j", async (rectangle) => {
    vi.mocked(spawn).mockClear();
    await expect(grabPixels(rectangle)).rejects.toThrow(/invalid crop rectangle/);
    expect(spawn).not.toHaveBeenCalled();
    const grab = vi.fn();
    await expect(capture(rectangle, grab)).rejects.toThrow(/invalid crop rectangle/);
    expect(grab).not.toHaveBeenCalled();
  });

  it.each([
    "null", "false", "1", '"rectangle"', "[]", "{}",
    '{"x":0,"y":0,"width":"1","height":1}',
    '{"x":0,"y":0,"height":1}',
  ])("refuses malformed geometry before launching a native grab: %s", async (json) => {
    const rectangle = JSON.parse(json);
    vi.mocked(spawn).mockClear();
    await expect(grabPixels(rectangle)).rejects.toThrow(CaptureFailedError);
    await expect(capture(rectangle)).rejects.toThrow(/invalid crop rectangle/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("refuses a crop beyond the actual root bounds", async () => {
    const grabbed = dump({ width: 4, height: 3, originX: 0, originY: 0, pixel: () => [0, 0, 0] });
    await expect(capture({ x: 4, y: 0, width: 1, height: 1 }, async () => grabbed)).rejects.toThrow(/outside/);
    await expect(capture({ x: 0, y: 3, width: 1, height: 1 }, async () => grabbed)).rejects.toThrow(/outside/);
  });

  it("intersects negative crops rather than shifting them into unrelated pixels", () => {
    const screen = decodeXwd(dump({ width: 4, height: 4, originX: 10, originY: 20, pixel: (x, y) => [x, y, 0] }));
    const cropped = cropScreen(screen, { x: 8, y: 19, width: 3, height: 3 });
    expect([cropped.width, cropped.height]).toEqual([1, 2]);
    expect([...cropped.pixels]).toEqual([0, 0, 0, 0, 1, 0]);
    for (const rectangle of [
      { x: 1, y: 1, width: 2, height: 2 },
      { x: 14, y: 20, width: 1, height: 1 },
      { x: 10, y: 24, width: 1, height: 1 },
      { x: NaN, y: 20, width: 1, height: 1 },
    ]) expect(() => cropScreen(screen, rectangle)).toThrow(CaptureFailedError);
  });

  it("rejects hostile headers and truncated rows before allocation", () => {
    const valid = dump({ width: 2, height: 2, originX: 0, originY: 0, pixel: () => [1, 2, 3] });
    for (const [word, value] of [[0, 99], [1, 8], [4, 0xffffffff], [5, 0], [7, 2], [12, 1], [14, 0], [19, 0xffffffff]]) {
      const bad = Buffer.from(valid);
      bad.writeUInt32BE(value, word * 4);
      expect(() => decodeXwd(bad)).toThrow(CaptureFailedError);
    }
    expect(() => decodeXwd(valid.subarray(0, valid.length - 1))).toThrow(CaptureFailedError);
  });

  it("decodes big endian XRGB without treating padding as red", () => {
    const big = dump({ width: 1, height: 1, originX: 0, originY: 0, pixel: () => [0, 0, 0] });
    big.writeUInt32BE(1, 7 * 4);
    big.set([0, 10, 20, 30], 100);
    expect([...decodeXwd(big).pixels]).toEqual([10, 20, 30]);
  });

  it("bounds subprocess stdout, stderr and runtime", async () => {
    await expect(run(process.execPath, ["-e", "process.stdout.write('x'.repeat(10000))"], 1000, 100)).rejects.toThrow(/output limit/);
    await expect(run(process.execPath, ["-e", "process.stderr.write('x'.repeat(10000))"], 1000)).rejects.toThrow(/diagnostic limit/);
    await expect(run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], 50)).rejects.toThrow(/time limit/);
  });
});

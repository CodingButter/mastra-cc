// Native captures crop the visible desktop at an element's screen rectangle.
// Overlapping windows can appear: these pixels are not an application-ownership witness.

import { spawn } from "node:child_process";
import { deflateSync } from "node:zlib";

/** How much screen this daemon will hand back in one answer. A whole desk at
 *  1024x768 encodes to a few hundred kilobytes; a run of these would be the
 *  largest thing on the wire by an order of magnitude, so there is a ceiling
 *  and it is refused rather than silently resized. */
export const CAPTURE_MAX_BYTES = 4 * 1024 * 1024;
export const CAPTURE_MAX_PIXELS = 16 * 1024 * 1024;
const DUMP_MAX_BYTES = 72 * 1024 * 1024;

export interface CaptureRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CapturedImage {
  format: "png";
  width: number;
  height: number;
  data: string;
}

export class CaptureFailedError extends Error {}

interface RawScreen {
  width: number;
  height: number;
  /** Where on the desk the top left of these pixels is, as the dump reported
   *  it. A crop asked for in screen coordinates is placed with this. */
  originX: number;
  originY: number;
  /** Row-major RGB, three bytes per pixel. */
  pixels: Buffer;
}

/** Read an XWD dump into plain RGB. Only the shape an X server actually
 *  produces for a modern TrueColor screen is accepted - 24 or 32 bits a pixel,
 *  ZPixmap - and anything else is refused by name rather than guessed at, since
 *  a wrongly guessed pixel format is a picture of nothing. */
export function decodeXwd(dump: Buffer): RawScreen {
  if (dump.length < 100) throw new CaptureFailedError("the screen grab came back too short to be an X window dump");
  const word = (index: number) => dump.readUInt32BE(index * 4);
  const headerSize = word(0);
  const format = word(2);
  const width = word(4);
  const height = word(5);
  const byteOrder = word(7);
  const bitsPerPixel = word(11);
  const bytesPerLine = word(12);
  const colours = word(19);
  if (format !== 2) {
    throw new CaptureFailedError(`this screen grab is in X pixmap format ${format}, and this daemon reads ZPixmap only`);
  }
  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) {
    throw new CaptureFailedError(`this screen grab has ${bitsPerPixel} bits a pixel, and this daemon reads 24 or 32`);
  }
  const start = headerSize + colours * 12;
  const stride = bitsPerPixel / 8;
  if (dump.length > DUMP_MAX_BYTES || word(1) !== 7 || headerSize < 100 ||
      headerSize > dump.length || width === 0 || height === 0 ||
      width * height > CAPTURE_MAX_PIXELS || byteOrder > 1 || word(6) !== 0 ||
      (word(13) !== 4 && word(13) !== 5) || word(14) !== 0xff0000 || word(15) !== 0xff00 || word(16) !== 0xff ||
      bytesPerLine < width * stride || start > dump.length ||
      bytesPerLine * height > dump.length - start) {
    throw new CaptureFailedError("invalid, truncated, unsupported or oversized X window dump");
  }
  if (word(13) === 5) {
    if (colours !== 256) throw new CaptureFailedError("unsupported DirectColor palette");
    for (let i = 0; i < colours; i += 1) {
      const at = headerSize + i * 12;
      if (dump.readUInt32BE(at) !== i * 0x010101 ||
          [4, 6, 8].some((offset) => dump.readUInt16BE(at + offset) !== i * 257)) {
        throw new CaptureFailedError("unsupported non-linear DirectColor palette");
      }
    }
  }
  const pixels = Buffer.allocUnsafe(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    let source = start + y * bytesPerLine;
    let target = y * width * 3;
    for (let x = 0; x < width; x += 1) {
      // X hands back BGRX on a little-endian server and XRGB on a big-endian
      // one. The header says which, so neither is assumed.
      const b0 = dump[source];
      const b1 = dump[source + 1];
      const b2 = dump[source + 2];
      if (byteOrder === 0) {
        pixels[target] = b2;
        pixels[target + 1] = b1;
        pixels[target + 2] = b0;
      } else {
        const offset = stride === 4 ? 1 : 0;
        pixels[target] = dump[source + offset];
        pixels[target + 1] = dump[source + offset + 1];
        pixels[target + 2] = dump[source + offset + 2];
      }
      source += stride;
      target += 3;
    }
  }
  return { width, height, originX: word(22) | 0, originY: word(23) | 0, pixels };
}

function validateRectangle(rectangle: CaptureRectangle): void {
  if (rectangle === null || typeof rectangle !== "object" || Array.isArray(rectangle)) {
    throw new CaptureFailedError("invalid crop rectangle");
  }
  const { x, y, width, height } = rectangle;
  if (![x, y, width, height, x + width, y + height].every(Number.isSafeInteger) ||
      width <= 0 || height <= 0 || width * height > CAPTURE_MAX_PIXELS) {
    throw new CaptureFailedError("invalid crop rectangle");
  }
}

/** Cut a rectangle named in SCREEN coordinates out of a dump that begins
 *  wherever its window begins. Both coordinate systems are the desk's, so the
 *  only arithmetic is the window origin the dump itself reported. */
export function cropScreen(screen: RawScreen, rectangle: CaptureRectangle): RawScreen {
  validateRectangle(rectangle);
  const left = rectangle.x - screen.originX;
  const top = rectangle.y - screen.originY;
  const x = Math.max(0, left);
  const y = Math.max(0, top);
  const width = Math.min(left + rectangle.width, screen.width) - x;
  const height = Math.min(top + rectangle.height, screen.height) - y;
  if (width <= 0 || height <= 0 || x >= screen.width || y >= screen.height) {
    throw new CaptureFailedError(
      `that rectangle (${rectangle.x}, ${rectangle.y} ${rectangle.width} by ${rectangle.height}) lies outside the ` +
        `${screen.width} by ${screen.height} of pixels that were grabbed - there is nothing there to look at`,
    );
  }
  const pixels = Buffer.allocUnsafe(width * height * 3);
  for (let row = 0; row < height; row += 1) {
    screen.pixels.copy(pixels, row * width * 3, ((y + row) * screen.width + x) * 3, ((y + row) * screen.width + x + width) * 3);
  }
  return { width, height, originX: screen.originX + x, originY: screen.originY + y, pixels };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

export function encodePng(screen: RawScreen): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(screen.width, 0);
  header.writeUInt32BE(screen.height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour, no alpha
  const raw = Buffer.allocUnsafe(screen.height * (screen.width * 3 + 1));
  for (let y = 0; y < screen.height; y += 1) {
    const line = y * (screen.width * 3 + 1);
    raw[line] = 0; // filter: none
    screen.pixels.copy(raw, line + 1, y * screen.width * 3, (y + 1) * screen.width * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function run(command: string, args: string[], timeoutMs = 5000, maxBytes = DUMP_MAX_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let size = 0;
    let error = "";
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      reject(new CaptureFailedError(message));
    };
    const timer = setTimeout(() => fail("screen grab exceeded its time limit"), timeoutMs);
    child.stdout.on("data", (piece: Buffer) => {
      if (settled) return;
      size += piece.length;
      if (size > maxBytes) return fail("screen grab exceeded its output limit");
      out.push(piece);
    });
    child.stderr.on("data", (piece: Buffer) => {
      if (settled) return;
      if (Buffer.byteLength(error) + piece.length > 8192) return fail("screen grab exceeded its diagnostic limit");
      error += piece.toString();
    });
    child.on("error", () => fail(`screen grab could not start ${command}`));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) return fail(`screen grab failed: ${error.trim().split("\n")[0] || code}`);
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(out, size));
    });
  });
}

/** Read the visible desktop, not a guessed application drawable. capture crops
 * the root pixels to the requested rectangle, including any overlapping windows.
 * Geometry may change between element observation and capture; this is not an
 * authenticated or atomic application-owned screenshot. */
export async function grabPixels(rectangle: CaptureRectangle | undefined): Promise<Buffer> {
  if (rectangle !== undefined) validateRectangle(rectangle);
  return run("xwd", ["-root", "-silent"]);
}

export async function capture(
  rectangle: CaptureRectangle | undefined,
  grab: (rectangle: CaptureRectangle | undefined) => Promise<Buffer> = grabPixels,
): Promise<CapturedImage> {
  if (rectangle !== undefined) validateRectangle(rectangle);
  const screen = decodeXwd(await grab(rectangle));
  const wanted = rectangle === undefined ? screen : cropScreen(screen, rectangle);
  const png = encodePng(wanted);
  if (png.length > CAPTURE_MAX_BYTES) {
    throw new CaptureFailedError(
      `that picture encodes to ${png.length} bytes and this daemon answers with at most ${CAPTURE_MAX_BYTES} - ` +
        `name a smaller part of the desk rather than the whole of it`,
    );
  }
  return { format: "png", width: wanted.width, height: wanted.height, data: png.toString("base64") };
}

import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

// This fixture reader accepts the daemon encoder's RGB8, unfiltered PNGs only.
export function verifyPixels(png, pattern) {
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  assert(width >= 320 && width <= 3840 && height >= 180 && height <= 2160);
  assert.equal(png[24], 8); assert.equal(png[25], 2);
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    assert(offset + length + 12 <= png.length);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const stride = width * 3 + 1;
  const pixels = inflateSync(Buffer.concat(chunks), { maxOutputLength: height * stride });
  assert.equal(pixels.length, height * stride);
  const pixel = (x, y) => {
    assert.equal(pixels[y * stride], 0);
    return [...pixels.subarray(y * stride + 1 + x * 3, y * stride + 4 + x * 3)];
  };
  if (pattern === 'ui') {
    for (const [x, y, expected] of [[10, 10, [31, 41, 56]], [245, 5, [214, 224, 232]]]) {
      assert(pixel(x, y).every((value, index) => Math.abs(value - expected[index]) <= 1), 'synthetic UI region mismatch');
    }
  } else {
    assert.equal(pattern, 'noise');
    assert.deepEqual(pixel(0, 0), [177, 121, 157], 'seeded noise first pixel');
    assert.deepEqual(pixel(1, 0), [128, 49, 127], 'seeded noise second pixel');
    assert(new Set(Array.from({ length: 64 }, (_, x) => pixel(x, 0).join(','))).size > 60, 'noise variation missing');
  }
}

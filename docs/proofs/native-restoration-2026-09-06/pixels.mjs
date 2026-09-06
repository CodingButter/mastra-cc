// Proof-only decoders: no production image or crop implementation is an oracle.
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

export function decodeXwd(data) {
  assert.ok(data.length >= 100, 'short XWD header');
  const h = Array.from({ length: 25 }, (_, i) => data.readUInt32BE(i * 4));
  const [header, version, format, depth, width, height, xoffset, order] = h;
  assert.ok(header >= 100 && version === 7 && format === 2 && depth === 24 && xoffset === 0,
    'proof requires XWD v7, ZPixmap, depth 24, zero xoffset');
  assert.ok(width > 0 && height > 0 && width <= 4096 && height <= 4096);
  assert.ok(order === 0 || order === 1, 'unsupported XWD byte order');
  assert.ok(h[11] === 24 || h[11] === 32, 'unsupported XWD bits per pixel');
  assert.ok(h[13] === 4 || h[13] === 5, 'proof requires TrueColor or DirectColor XWD');
  assert.deepEqual(h.slice(14, 17), [0xff0000, 0xff00, 0xff], 'unsupported XWD channel masks');
  const bytes = h[11] / 8, stride = h[12], start = header + h[19] * 12;
  assert.ok(stride >= width * bytes && start + stride * height <= data.length, 'truncated XWD pixels');
  const channels = [new Map(), new Map(), new Map()];
  if (h[13] === 5) {
    for (let i = 0; i < h[19]; i++) {
      const at = header + i * 12, pixel = data.readUInt32BE(at);
      for (let c = 0; c < 3; c++) {
        channels[c].set((pixel >>> (16 - c * 8)) & 255,
          Math.round(data.readUInt16BE(at + 4 + c * 2) / 257));
      }
    }
    for (const channel of channels) assert.equal(channel.size, 256, 'incomplete DirectColor channel');
  }
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = start + y * stride + x * bytes;
    const pixel = order === 0 ? data.readUIntLE(offset, bytes) : data.readUIntBE(offset, bytes);
    const out = (y * width + x) * 3;
    for (let c = 0; c < 3; c++) {
      const index = (pixel >>> (16 - c * 8)) & 255;
      rgb[out + c] = h[13] === 5 ? channels[c].get(index) : index;
    }
  }
  return { width, height, rgb };
}

export function decodePng(data) {
  assert.deepEqual(data.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(data.toString('ascii', 12, 16), 'IHDR');
  assert.equal(data.readUInt32BE(8), 13);
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  assert.ok(width > 0 && height > 0 && width <= 4096 && height <= 4096);
  assert.deepEqual([...data.subarray(24, 29)], [8, 2, 0, 0, 0], 'proof requires noninterlaced RGB8 PNG');
  const chunks = [];
  let ended = false;
  for (let offset = 8; offset < data.length;) {
    assert.ok(offset + 12 <= data.length, 'short PNG chunk');
    const length = data.readUInt32BE(offset), end = offset + 12 + length;
    assert.ok(end <= data.length, 'truncated PNG chunk');
    const type = data.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(data.subarray(offset + 8, end - 4));
    if (type === 'IEND') { assert.equal(length, 0); assert.equal(end, data.length); ended = true; }
    offset = end;
  }
  assert.ok(ended && chunks.length, 'PNG missing data/end');
  const stride = width * 3;
  const raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: (stride + 1) * height });
  assert.equal(raw.length, (stride + 1) * height);
  const rgb = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4, 'invalid PNG filter');
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const a = x >= 3 ? rgb[at - 3] : 0, b = y ? rgb[at - stride] : 0;
      const c = y && x >= 3 ? rgb[at - stride - 3] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      rgb[at] = (raw[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  return { width, height, rgb };
}

export function witness(root, capture, rectangle) {
  assert.equal(capture.width, rectangle.width);
  assert.equal(capture.height, rectangle.height);
  // First part of the rendered text, away from borders and the end-of-text caret.
  const region = { x: 12, y: 6, width: 108, height: rectangle.height - 12 };
  assert.ok(rectangle.width >= 240 && region.height >= 8 && region.height <= 100);
  function sample(image, ox, oy) {
    assert.ok(ox >= 0 && oy >= 0 && ox + region.width <= image.width && oy + region.height <= image.height);
    return Buffer.concat(Array.from({ length: region.height }, (_, y) => {
      const start = ((oy + y) * image.width + ox) * 3;
      return image.rgb.subarray(start, start + region.width * 3);
    }));
  }
  const x = rectangle.x + region.x, y = rectangle.y + region.y;
  const expected = sample(root, x, y), actual = sample(capture, region.x, region.y);
  const counts = new Map();
  for (let i = 0; i < expected.length; i += 3) {
    const color = expected.subarray(i, i + 3).toString('hex');
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  const colors = [...counts].sort((a, b) => b[1] - a[1]);
  assert.ok(colors.length >= 4 && colors[0][1] < expected.length / 3 * 0.98,
    'independent witness must contain substantial nonuniform rendered pixels');
  assert.deepEqual(actual, expected, 'capture interior differs from independent root XWD');
  // These negative controls exercise the same exact comparator on this actual scene.
  const blank = Buffer.alloc(expected.length);
  for (let i = 0; i < blank.length; i += 3) Buffer.from(colors[0][0], 'hex').copy(blank, i);
  assert.notDeepEqual(blank, expected, 'blank negative control unexpectedly matches');
  const shifts = [[1, 0], [-1, 0], [0, 1], [0, -1], [8, 0], [0, 8]];
  for (const [dx, dy] of shifts) assert.notDeepEqual(sample(root, x + dx, y + dy), expected,
    `shifted negative control unexpectedly matches: ${dx},${dy}`);
  return { region, comparison: 'exact RGB equality', pixels: expected.length / 3,
    colors: colors.map(([rgb, pixels]) => ({ rgb, pixels })), rejectedControls: { blank: true, shifts } };
}

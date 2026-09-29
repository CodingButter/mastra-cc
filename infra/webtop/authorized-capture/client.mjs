import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { connect } from "/opt/mastra-cc/transport/index.mjs";

const client = await connect({ socketPath: process.env.MASTRA_CC_SOCKET });
try {
  const result = await client.queryElements({ limit: 1000 });
  const target = result.elements.find(e => e.name === "Solid capture target");
  const protectedTarget = result.elements.find(e => e.name === "Protected capture target");
  assert(target, "synthetic target must be observable");
  assert(protectedTarget, "protected target must be observable");
  const captured = await client.captureElement({ id: target.id });
  assert(captured.image, JSON.stringify(captured.refusal));
  const { image } = captured;
  const expected = JSON.parse(readFileSync("/tmp/authorized-fixture-geometry.json", "utf8"));
  assert.equal(image.width, expected.width);
  assert.equal(image.height, expected.height);
  assert.equal(image.source, "visible-desktop");
  const png = Buffer.from(image.data, "base64");
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const compressed = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      assert.equal(data.readUInt32BE(0), expected.width);
      assert.equal(data.readUInt32BE(4), expected.height);
      assert.equal(data[8], 8); assert.equal(data[9], 2);
    }
    if (type === "IDAT") compressed.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(compressed));
  const stride = expected.width * 3 + 1;
  assert.equal(raw.length, stride * expected.height);
  for (let y = 8; y < expected.height - 8; y++) {
    assert.equal(raw[y * stride], 0, "encoder uses unfiltered rows");
    for (let x = 8; x < expected.width - 8; x++) {
      assert.deepEqual([...raw.subarray(y * stride + 1 + x * 3, y * stride + 4 + x * 3)], [24, 96, 168]);
    }
  }
  console.log(`PIXELS: verified solid RGB interior; ${image.width}x${image.height}; fixture bounds ${JSON.stringify(expected)}`);
  const protectedCapture = await client.captureElement({ id: protectedTarget.id });
  assert(!protectedCapture.image, JSON.stringify({ target: protectedTarget.id, role: protectedTarget.role, diagnostic: protectedTarget.diagnostic, refusal: protectedCapture.refusal, imageWidth: protectedCapture.image?.width }));
  assert.equal(protectedCapture.refusal?.code, "UnperformableElementError");
  const unknown = await client.captureElement({ id: "ungranted-target" });
  assert(!unknown.image); assert(unknown.refusal);
  console.log("GUARDS: protected and unknown targets refused");
  console.log("PROOF: GREEN");
} finally {
  await client.close();
}

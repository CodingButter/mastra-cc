// CC-07 provenance: a clipped native picture is answered WITH the crop that
// says which part of the element it is (ADR-0105), and the desktop package
// maps a place in that picture back to the element fractions clickElement
// takes. Pixels are real (isolated Xvfb, native xwd, real PNG); accessibility
// identity is the committed GTK replay fixture; geometry alone is scripted.
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2] ?? '.');
const { AtspiBackend, replayChannel, handleRequest } = await import(pathToFileURL(join(root, 'daemon/dist/index.mjs')));
const { locateInElement, describeCapture } = await import(pathToFileURL(join(root, 'packages/desktop/dist/index.mjs')));
const tape = replayChannel('gtk-dialog');
let rectangle = [10, 10, 40, 30];
const backend = new AtspiBackend({ call: request => request.member === 'GetExtents' ? Promise.resolve([rectangle]) : tape.call(request), close: () => tape.close() }, 'all');
try {
  const { elements } = await backend.queryElements({});
  assert(elements.length > 0, 'fixture must publish a real backend id');
  const id = elements[0].id;
  const request = () => handleRequest({ type: 'request', id: 1, method: 'captureElement', params: { id } }, backend);
  const full = (await request()).result.image;
  assert.deepEqual([full.width, full.height, full.clipped, full.source], [40, 30, false, 'visible-desktop']);
  assert.deepEqual(full.crop, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(typeof full.capturedAt, 'number');
  console.log(`whole element: 40 by 30, clipped=false, crop 0,0,1,1, capturedAt=${full.capturedAt}`);
  // Xvfb is exactly 200 by 150; each rectangle hangs off one edge by a quarter.
  const cases = [
    { edge: 'left',   rect: [-10, 10, 40, 30],  crop: { x: 0.25, y: 0, width: 0.75, height: 1 } },
    { edge: 'right',  rect: [170, 10, 40, 30],  crop: { x: 0, y: 0, width: 0.75, height: 1 } },
    { edge: 'top',    rect: [10, -10, 40, 30],  crop: { x: 0, y: 1 / 3, width: 1, height: 2 / 3 } },
    { edge: 'bottom', rect: [10, 130, 40, 30],  crop: { x: 0, y: 0, width: 1, height: 2 / 3 } },
  ];
  for (const { edge, rect, crop } of cases) {
    rectangle = rect;
    const result = await request();
    const image = result.result?.image;
    assert(image, `${edge}: a clipped picture must be answered, not refused (${result.result?.refusal ?? result.error?.message})`);
    assert.equal(image.clipped, true, `${edge}: clipped`);
    for (const k of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(image.crop[k] - crop[k]) < 1e-12, `${edge}: crop.${k} ${image.crop[k]} != ${crop[k]}`);
    assert.equal(image.width, Math.round(rect[2] * crop.width), `${edge}: width`);
    assert.equal(image.height, Math.round(rect[3] * crop.height), `${edge}: height`);
    const centre = locateInElement(image, 0.5, 0.5);
    const text = describeCapture(image);
    assert(text.includes('CLIPPED'), 'model text names the clip');
    console.log(JSON.stringify({ edge, rect, image: [image.width, image.height], crop: image.crop, pictureCentreInElement: centre }));
  }
  rectangle = [200, 10, 40, 30];
  const off = await request();
  assert.equal(off.result?.image, undefined, 'an empty intersection is still refused');
  console.log(JSON.stringify({ edge: 'off-display', rect: rectangle, refusal: off.result?.refusal ?? off.error?.message ?? null }));
  console.log('PROOF: GREEN — real native capture answers four edge-clipped pictures with exact crops, maps their centres, and still refuses an empty intersection; scripted accessibility geometry');
} catch (error) {
  console.log(`PROOF: RED — ${error.message}`); process.exitCode = 1;
} finally { await backend.close(); }

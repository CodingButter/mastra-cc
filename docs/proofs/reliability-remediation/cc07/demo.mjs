import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2] ?? '.');
const { AtspiBackend, replayChannel, handleRequest } = await import(pathToFileURL(join(root, 'daemon/dist/index.mjs')));
const tape = replayChannel('gtk-dialog');
let rectangle = [10, 10, 40, 30];
const backend = new AtspiBackend({ call: request => request.member === 'GetExtents' ? Promise.resolve([rectangle]) : tape.call(request), close: () => tape.close() }, 'all');
let partialImages = 0, partialRefusals = 0;
try {
  const { elements } = await backend.queryElements({});
  assert(elements.length > 0, 'fixture must publish a real backend id');
  const id = elements[0].id;
  const request = () => handleRequest({ type: 'request', id: 1, method: 'captureElement', params: { id } }, backend);
  const full = await request();
  assert.equal(full.result?.image?.width, 40);
  assert.equal(full.result?.image?.height, 30);
  console.log('fully covered element: real XWD/PNG image retained, 40 by 30');
  // Xvfb is exactly 200 by 150; these cross each edge while retaining positive intersection.
  for (const shape of [[-10,10,40,30],[180,10,40,30],[10,-10,40,30],[10,130,40,30]]) {
    rectangle = shape;
    const result = await request();
    if (result.result?.image) partialImages++;
    if ((result.result?.refusal ?? result.refusal ?? '').includes('partial capture refused')) partialRefusals++;
    console.log(JSON.stringify({ rectangle: shape, image: !!result.result?.image, refusal: result.result?.refusal ?? result.refusal ?? null }));
  }
  assert.equal(partialImages, 0, 'partial images without crop provenance must not be returned');
  assert.equal(partialRefusals, 4, 'each edge must fail for partial capture, not an unrelated grab error');
  console.log('PROOF: GREEN — real native capture retains complete images and refuses four partial images; scripted accessibility geometry');
} catch (error) {
  console.log(`PROOF: RED — ${error.message}`); process.exitCode = 1;
} finally { await backend.close(); }

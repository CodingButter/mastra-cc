// CC-07 freshness: a press that names the picture it was aimed from is
// refused, and nothing sent, when the element has moved or been photographed
// again since (ADR-0107). Pixels are real (isolated Xvfb, native xwd, real
// PNG); accessibility identity is the committed GTK replay fixture; geometry
// and the pointer sink alone are scripted so the demo can count what was sent.
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2] ?? '.');
const { AtspiBackend, replayChannel } = await import(pathToFileURL(join(root, 'daemon/dist/index.mjs')));
const tape = replayChannel('gtk-dialog');
let rectangle = [10, 10, 40, 30];
const sent = [];
const backend = new AtspiBackend({
  call(request) {
    if (request.member === 'GetExtents') return Promise.resolve([rectangle]);
    if (request.member === 'GrabFocus') return Promise.resolve([true]);
    if (request.member === 'ScrollTo') return Promise.resolve([]);
    if (request.member === 'GenerateMouseEvent') { sent.push(request.body.slice(0, 2).map(Number)); return Promise.resolve([]); }
    return tape.call(request);
  },
  watch: (a, b, c) => tape.watch(a, b, c),
  close: () => tape.close(),
}, 'all');
const outcome = async (fn) => { try { return { ok: await fn() }; } catch (e) { return { refused: `${e.constructor.name}: ${e.message}` }; } };
try {
  const { elements } = await backend.queryElements({ role: 'label' });
  assert(elements.length > 0, 'fixture must publish a real backend id');
  const id = elements[0].id;
  const first = (await backend.captureElement({ id })).image;
  console.log(`picture 1 of ${id}: ${first.width}x${first.height} capturedAt=${first.capturedAt}`);

  const fresh = await outcome(() => backend.clickElement({ id, capturedAt: first.capturedAt, x: 0, y: 0 }));
  assert(fresh.ok, `a fresh picture must aim: ${fresh.refused}`);
  assert.deepEqual(sent, [[10, 10]], 'the press went to the picture\'s top-left');
  console.log(JSON.stringify({ case: 'latest picture, element unmoved', sent: sent.length, refused: null }));

  rectangle = [60, 10, 40, 30];
  const moved = await outcome(() => backend.clickElement({ id, capturedAt: first.capturedAt }));
  assert(moved.refused && /moved under the picture/.test(moved.refused), `moved element must refuse: ${JSON.stringify(moved)}`);
  assert.equal(sent.length, 1, 'nothing sent on refusal');
  console.log(JSON.stringify({ case: 'element moved since picture', sent: sent.length, refused: moved.refused }));

  await new Promise((r) => setTimeout(r, 5));
  const second = (await backend.captureElement({ id })).image;
  assert(second.capturedAt > first.capturedAt);
  const superseded = await outcome(() => backend.clickElement({ id, capturedAt: first.capturedAt }));
  assert(superseded.refused && /re-photographed/.test(superseded.refused), `older picture must refuse: ${JSON.stringify(superseded)}`);
  assert.equal(sent.length, 1, 'nothing sent on refusal');
  console.log(JSON.stringify({ case: 'older picture after a newer one', sent: sent.length, refused: superseded.refused }));

  const newest = await outcome(() => backend.clickElement({ id, capturedAt: second.capturedAt }));
  assert(newest.ok, `the newest picture must aim: ${newest.refused}`);
  assert.deepEqual(sent[1], [80, 25]);
  console.log(JSON.stringify({ case: 'newest picture at the moved rectangle', sent: sent.length, refused: null }));

  const unclaimed = await outcome(() => backend.clickElement({ id }));
  assert(unclaimed.ok, 'a press that names no picture is what it was before');
  console.log(JSON.stringify({ case: 'no picture named', sent: sent.length, refused: null }));
  console.log('PROOF: GREEN — a press naming a stale picture (moved element, or superseded picture) is refused before anything is sent; the latest picture and an unclaimed press still aim; real native capture, scripted geometry');
} catch (error) {
  console.log(`PROOF: RED — ${error.message}`); process.exitCode = 1;
} finally { await backend.close(); }

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { decodeXwd, decodePng, witness } from './pixels.mjs';
import { connect } from '../../../packages/desktop/dist/index.mjs';
import { entryRectangle } from './geometry.mjs';

const run = process.argv[2];
const expected = 'native restoration verified';
const deadline = setTimeout(() => {
  console.error('FAIL: proof exceeded 65 seconds');
  process.exit(1);
}, 65_000);
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: timed out`)), 8000);
    })]);
  } finally { clearTimeout(timer); }
}
async function waitFor(label, probe) {
  for (let i = 0; i < 40; i++) {
    const result = await bounded(probe(), label);
    if (result) return result;
    await sleep(200);
  }
  throw new Error(`${label}: did not become ready`);
}
async function rpc(method, params) {
  const result = await bounded(client[method](params), method);
  console.log(JSON.stringify({ method, result: method === 'captureElement'
    ? { ...result, image: result.image && { ...result.image, data: '<saved PNG>' } } : result }));
  assert.equal(result.refusal, undefined, `${method} refused: ${result.refusal}`);
  return result;
}
let client;
try {
  const url = await waitFor('daemon WebSocket', async () => {
    const log = await readFile(`${run}/daemon.log`, 'utf8').catch(() => '');
    const match = /websocket listening on (127\.0\.0\.1:\d+)/.exec(log);
    return match && `ws://${match[1]}`;
  });
  client = await bounded(connect({ url }), 'connect');
  await waitFor('GTK application registration', async () => {
    const { applications } = await rpc('listApplications', {});
    return applications.some((application) => application.name.toLowerCase() === 'yad' && application.running === 'answering');
  });
  const entry = await waitFor('GTK form entry', async () => {
    const { elements: discovered } = await rpc('queryElements', { application: 'yad' });
    const elements = discovered.filter((element) => element.operations.some(
      (operation) => operation.operation === 'setText' && operation.availability === 'available'));
    if (!elements.length) return null;
    assert.equal(elements.length, 1, 'fixture must expose exactly one editable text element');
    return elements[0];
  });
  assert.equal(entry.content.kind, 'text');
  assert.equal(entry.content.value, 'before restoration');
  const edited = await rpc('setElementText', { id: entry.id, text: expected });
  assert.ok(edited.element, 'edit did not return readback');
  const read = await rpc('readElementContent', { id: entry.id, offset: 0, limit: 200 });
  assert.deepEqual(read.content, { kind: 'text', value: expected });

  // Allow GTK to paint the public API edit before taking the independent witness.
  await sleep(300);
  const rectangle = await bounded(entryRectangle(), 'independent entry bounds');
  const rootXwd = execFileSync('xwd', ['-root', '-silent'], { maxBuffer: 8000000, timeout: 8000 });
  await writeFile(`${run}/root-after.xwd`, rootXwd);
  const { image } = await rpc('captureElement', { id: entry.id });
  assert.ok(image, 'capture returned no image');
  assert.equal(image.format, 'png');
  assert.equal(image.width, rectangle.width);
  assert.equal(image.height, rectangle.height);
  const png = Buffer.from(image.data, 'base64');
  await writeFile(`${run}/entry.png`, png);
  await writeFile(`${run}/entry-bounds.json`, JSON.stringify(rectangle, null, 2));
  const evidence = witness(decodeXwd(rootXwd), decodePng(png), rectangle);
  await writeFile(`${run}/pixel-witness.json`, JSON.stringify(evidence, null, 2));

  const { elements: buttons } = await rpc('queryElements', { application: 'yad', role: 'button', name: 'Prove click' });
  assert.equal(buttons.length, 1, 'expected exactly one fixture button');
  assert.equal(await readFile(`${run}/clicked`, 'utf8').catch(() => null), null, 'click marker existed before click');
  const clicked = await rpc('clickElement', { id: buttons[0].id });
  assert.ok(clicked.element, 'click did not return readback');
  await waitFor('fixture click callback', async () => {
    const marker = await readFile(`${run}/clicked`, 'utf8').catch(() => null);
    if (marker === null) return false;
    assert.equal(marker, 'clicked\n');
    return true;
  });
  console.log('PASS: text readback, independent dimensions and exact visible-pixel witness (blank/shift controls), and real button callback');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  client?.close();
  clearTimeout(deadline);
}

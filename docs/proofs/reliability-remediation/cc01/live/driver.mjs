// CC-01 live: what a capture says when another window sits on the element,
// what a keystroke does, what the ONE permitted foreground route (a task-bar
// button pressed with activateElement) changes, whether the daemon's focus
// restoration undoes that route, and what a layout change after preparation
// does to a press aimed from the picture. Real GTK windows on a real X server
// and accessibility bus, seen only through the daemon. No model, no network.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {setTimeout as sleep} from 'node:timers/promises';
import {MastraCC} from '@mastra-cc/desktop/mastra';
const run = process.argv[2];
const log = (event, data = {}) => fs.appendFileSync(`${run}/trace.jsonl`, JSON.stringify({event, monotonicMs: performance.now(), ...data}) + '\n');
globalThis.fetch = async () => { throw Error('model/network calls forbidden'); };
let desk;
const command = (line) => { fs.writeFileSync(`${run}/commands`, line + '\n'); log('command', {line}); };
const appLog = () => fs.readFileSync(`${run}/app.log`, 'utf8');
const said = (want) => appLog().split('\n').filter((l) => l.includes(want)).length;
// Count occurrences rather than test for presence: the fixture says "covered"
// twice in this run, and a presence test would let the second command through
// unawaited and photograph the desk before the window moved.
// The fixture reopens its command pipe after each writer closes, so a command
// written inside that window is simply lost. Resend until the fixture answers:
// every command here is idempotent, and a lost command is a harness fact, not
// a desk fact worth reporting as a phase failure.
const tell = async (line, want) => { const already = said(want); for (let i = 0; i < 40; i++) { command(line); for (let j = 0; j < 10; j++) { if (said(want) > already) return; await sleep(100); } } throw Error(`fixture never said ${JSON.stringify(want)} after ${line}`); };
const phases = [];
const phase = (name, data, ok) => { const p = {phase: name, ...data, ok}; phases.push(p); log('phase', p); assert.ok(ok, `${name}: ${JSON.stringify(data)}`); };

// The daemon encoder writes RGB8, unfiltered PNGs; this reads those only.
function dominant(png) {
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  assert.equal(png[24], 8); assert.equal(png[25], 2);
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const stride = width * 3 + 1, pixels = inflateSync(Buffer.concat(chunks), {maxOutputLength: height * stride});
  const buckets = new Map();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = y * stride + 1 + x * 3, key = `${pixels[o] >> 5},${pixels[o + 1] >> 5},${pixels[o + 2] >> 5}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const [key, count] = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0];
  const [r, g, b] = key.split(',').map((v) => Number(v) << 5);
  const name = b > 128 && r < 96 ? 'cover-blue' : r > 128 && b < 96 ? 'target-red' : r > 128 && g > 128 && b > 128 ? 'entry-light' : 'other';
  return {width, height, share: count / (width * height), name, rgbBucket: [r, g, b]};
}

try {
  let address;
  for (let i = 0; i < 80; i++) { const m = /websocket listening on (127\.0\.0\.1:\d+)/.exec(fs.existsSync(`${run}/daemon.log`) ? fs.readFileSync(`${run}/daemon.log`, 'utf8') : ''); if (m) { address = `ws://${m[1]}`; break; } await sleep(250); }
  assert.ok(address, 'daemon ready');
  desk = new MastraCC({url: address}); await desk.client(); const tools = desk.getTools();
  async function call(name, args) { const r = await tools[name].execute(args); log('tool', {name, args, result: name === 'captureElement' ? {...r, image: r.image && {...r.image, data: `${r.image.data?.length ?? 0} base64 chars`}} : r}); return r; }
  async function must(name, args) { const r = await call(name, args); assert.ok(!r.refusal && !r.error, `${name}: ${r.refusal ?? JSON.stringify(r.error ?? r)}`); return r; }
  const shot = async (id) => (await must('captureElement', {id})).image;
  const png = (image) => Buffer.from(image.data, 'base64');
  const receipts = () => fs.existsSync(`${run}/audit.jsonl`) ? fs.readFileSync(`${run}/audit.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

  for (let i = 0; i < 60 && !appLog().includes('ready target@'); i++) await sleep(100);
  assert.ok(appLog().includes('ready target@'), 'the fixture never came up'); await sleep(1500);
  let field, taskTarget, elements;
  for (let i = 0; i < 60; i++) {
    const apps = await call('listApplications', {});
    if (apps.applications?.some((a) => a.name === 'cc01-fixture' && a.running === 'answering')) {
      elements = (await must('queryElements', {application: 'cc01-fixture', limit: 500})).elements;
      field = elements.find((e) => e.name === 'field'); taskTarget = elements.find((e) => e.name === 'task:Target');
      if (field && taskTarget) break;
    }
    await sleep(250);
  }
  assert.ok(field && taskTarget, `fixture elements found (field=${field?.id}, task=${taskTarget?.id})`);
  fs.writeFileSync(`${run}/inventory.json`, JSON.stringify(elements.map((e) => ({id: e.id, role: e.role, name: e.name})), null, 2));
  const fresh = async () => (await must('queryElements', {application: 'cc01-fixture', limit: 500})).elements.find((e) => e.name === 'field');

  // 1. Covered: capture answers, with another window's pixels, and says
  //    nothing about it - a capture is a look at the desk, not at the window.
  const before = receipts().length;
  const covered = await shot(field.id);
  const coveredPixels = dominant(png(covered));
  fs.writeFileSync(`${run}/covered.png`, png(covered));
  const captureReceipts = receipts().slice(before);
  phase('covered-capture', {
    fieldAsObserved: field, pixels: coveredPixels, clipped: covered.clipped, crop: covered.crop, source: covered.source,
    receiptsWritten: captureReceipts.map((r) => ({scope: r.scope, outcome: r.outcome})),
    reading: 'the picture is the Cover window, the contract reports no occlusion, and the receipt is a read, not an effect',
  }, coveredPixels.name === 'cover-blue' && coveredPixels.share > 0.9 && covered.clipped === false && captureReceipts.length >= 1 && captureReceipts.every((r) => r.scope === 'observe' && r.outcome === 'read'));

  // The fixture answers "text" with a fresh line; count lines so an old
  // answer is never mistaken for this one.
  const fieldText = async () => { const n = appLog().split('\n').filter((l) => l.startsWith('text=')).length; command('text'); for (let i = 0; i < 40; i++) { const lines = appLog().split('\n').filter((l) => l.startsWith('text=')); if (lines.length > n) return lines[lines.length - 1].slice(5); await sleep(50); } throw Error('fixture never answered text'); };

  // 2. A keystroke at the covered element. Recorded, not presumed: the
  //    daemon either refuses before emission (text unchanged) or grabs the
  //    focus and the keys land (readback matches). Anything else is a lie.
  const typedCovered = await call('typeText', {id: field.id, text: 'covered'});
  const afterCoveredText = await fieldText();
  await sleep(300);
  const afterCoveredShot = dominant(png(await shot((await fresh()).id)));
  const coveredOutcome = typedCovered.refusal ? 'refused' : 'landed';
  phase('keystroke-while-covered', {outcome: coveredOutcome, refusal: typedCovered.refusal ?? null, fieldText: afterCoveredText,
    focusNote: typedCovered.element?.diagnostic?.['mastra-cc/focus-preservation'] ?? null, pixelsAfter: afterCoveredShot,
    reading: coveredOutcome === 'refused' ? 'refused before emission; nothing landed' : 'the focus grab handed the keyboard to Target and the keys landed; pixelsAfter says whether that grab also raised the window'},
    (coveredOutcome === 'refused' && afterCoveredText === "'untouched'") || (coveredOutcome === 'landed' && afterCoveredText === "'covered'"));

  // 3. Cover again, then the permitted route: press the shell's button for Target.
  await tell('cover', 'covered'); await sleep(600);
  const recoveredFirst = dominant(png(await shot((await fresh()).id)));
  assert.equal(recoveredFirst.name, 'cover-blue', 're-covered before the route');
  const taskAction = taskTarget.actions?.find((a) => a.availability === 'available')?.name;
  assert.ok(taskAction, `the task-bar button publishes an action: ${JSON.stringify(taskTarget.actions)}`);
  const raised = await must('activateElement', {id: taskTarget.id, action: taskAction});
  for (let i = 0; i < 40 && !appLog().includes('presented Target'); i++) await sleep(100);
  assert.ok(appLog().includes('presented Target'), 'the shell button never presented Target'); await sleep(400);
  const afterRaise = await fresh();
  const raisedCapture = await shot(afterRaise.id);
  const raisedPixels = dominant(png(raisedCapture));
  fs.writeFileSync(`${run}/raised.png`, png(raisedCapture));
  phase('raised-by-task-bar-button', {action: taskAction, pixels: raisedPixels, focusNote: raised.element?.diagnostic?.['mastra-cc/focus-preservation'] ?? null,
    reading: 'after the permitted route and a fresh observation, the picture is the entry itself'},
    raisedPixels.name !== 'cover-blue');

  // 4. Does the daemon's focus restoration undo the route? typeText reads
  //    focus before, grabs the entry, types, and puts focus back where it was.
  const typedRaised = await must('typeText', {id: afterRaise.id, text: 'raised'});
  const afterRaisedText = await fieldText();
  await sleep(300);
  const afterTypePixels = dominant(png(await shot((await fresh()).id)));
  phase('keystroke-after-raise', {fieldText: afterRaisedText, focusNote: typedRaised.element?.diagnostic?.['mastra-cc/focus-preservation'] ?? null,
    pixelsAfter: afterTypePixels, reading: 'the key lands; pixelsAfter records whether focus restoration re-covered Target'},
    afterRaisedText === "'raised'");

  // 5. Layout change after preparation: Target moves; a press aimed from the
  //    last picture is refused before any input (CC-07 freshness).
  const picture = await shot((await fresh()).id);
  await tell('move-target', 'moved target'); await sleep(500);
  const moved = await fresh();
  const stale = await call('clickElement', {id: moved.id, capturedAt: picture.capturedAt});
  const afterStaleText = await fieldText();
  phase('press-from-old-picture-after-move', {refusal: stale.refusal ?? null, fieldText: afterStaleText,
    reading: 'the element moved after the picture; the press is refused, nothing sent'},
    typeof stale.refusal === 'string' && /moved|rectangle|picture|captur/i.test(stale.refusal) && afterStaleText === "'raised'");

  // 6. Covered again after a good preparation: foreground was never proof of
  //    non-occlusion. The fresh capture says what is there now.
  await tell('cover', 'covered'); await sleep(600);
  const recovered = await shot((await fresh()).id);
  const recoveredPixels = dominant(png(recovered));
  phase('covered-again', {pixels: recoveredPixels, reading: 'a later overlay is visible only by looking again; nothing in the earlier route promised otherwise'},
    recoveredPixels.name === 'cover-blue');

  fs.writeFileSync(`${run}/result.json`, JSON.stringify({scope: 'three GTK3 windows under Openbox on Xvfb; the shell task-bar button is a fixture stand-in; one desk, one toolkit', phases, receipts: receipts().length}, null, 2));
} finally { try { command('quit'); } catch {} await desk?.close(); }

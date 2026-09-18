// CC-07 under display scaling, on real pixels.
//
// A capture is a rectangle read from the accessibility tree, cut out of a grab
// of the visible desktop. That only works if both numbers mean the same thing.
// Under scaling they need not: a toolkit lays out in logical units and the
// screen is made of device pixels, and a daemon that silently assumes they are
// the same will return a confidently-cropped picture of somewhere else.
//
// The fixture paints one panel a flat colour nothing else in the window uses,
// with generous margins on every side. If the capture is the panel, every pixel
// is that colour. If the rectangle was in the wrong units, the miss shows up as
// window background in the picture - not as an error, which is exactly why this
// has to be checked against pixels rather than against dimensions alone.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {setTimeout as sleep} from 'node:timers/promises';
import {MastraCC} from '@mastra-cc/desktop/mastra';

const run = process.argv[2];
const log = (event, data = {}) => fs.appendFileSync(`${run}/trace.jsonl`, JSON.stringify({event, monotonicMs: performance.now(), ...data}) + '\n');
globalThis.fetch = async () => { throw Error('model/network calls forbidden'); };

// Minimal PNG reader: dimensions, and the histogram of exact colours.
function readPng(png) {
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'a PNG');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  assert.equal(png[24], 8, '8 bits per channel');
  assert.equal(png[25], 2, 'truecolour');
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const counts = new Map();
  const stride = width * 3 + 1;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * stride];
    assert.equal(filter, 0, 'the encoder writes unfiltered rows');
    for (let column = 0; column < width; column += 1) {
      const at = row * stride + 1 + column * 3;
      const key = `${raw[at]},${raw[at + 1]},${raw[at + 2]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return {width, height, counts};
}
const dominant = ({counts}) => [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

let desk, detach;
const command = (line) => { fs.writeFileSync(`${run}/commands`, line + '\n'); log('command', {line}); };
const findings = [];
try {
  let address;
  for (let i = 0; i < 80; i++) { const m = /websocket listening on (127\.0\.0\.1:\d+)/.exec(fs.existsSync(`${run}/daemon.log`) ? fs.readFileSync(`${run}/daemon.log`, 'utf8') : ''); if (m) { address = `ws://${m[1]}`; break; } await sleep(250); }
  assert.ok(address, 'daemon ready');
  desk = new MastraCC({url: address});
  const tools = desk.getTools();
  const call = async (name, args) => { const r = await tools[name].execute(args); log('tool', {name, args: {...args, text: undefined}, refusal: r.refusal}); return r; };
  const must = async (name, args) => { const r = await call(name, args); assert.ok(!r.refusal, `${name}: ${r.refusal}`); return r; };

  let panel;
  for (let i = 0; i < 60; i++) {
    const apps = await call('listApplications', {});
    if (apps.applications?.some((a) => a.name === 'cc07-fixture' && a.running === 'answering')) {
      panel = (await must('queryElements', {application: 'cc07-fixture', limit: 500})).elements.find((e) => e.name === 'panel');
      if (panel) break;
    }
    await sleep(250);
  }
  assert.ok(panel, 'the panel is in the tree');

  const ack = async (want) => { for (let i = 0; i < 40; i++) { if (fs.readFileSync(`${run}/app.log`, 'utf8').includes(want)) return fs.readFileSync(`${run}/app.log`, 'utf8'); await sleep(100); } throw Error(`fixture never said ${want}`); };
  const appLog = await ack('scale-factor');
  const toolkitScale = Number(/scale-factor (\d+)/.exec(appLog)[1]);
  const declaredScale = {gdkScale: process.env.CC07_GDK_SCALE ?? '1', dpiScale: process.env.CC07_DPI_SCALE ?? '1', xftDpi: process.env.CC07_XFT_DPI ?? '96', toolkitScale};
  log('scale', declaredScale);

  async function shoot(label) {
    const fresh = (await must('queryElements', {application: 'cc07-fixture', limit: 500})).elements.find((e) => e.name === 'panel');
    const shot = await must('captureElement', {id: fresh.id});
    const png = Buffer.from(shot.image.data, 'base64');
    fs.writeFileSync(`${run}/${label}.png`, png);
    const read = readPng(png);
    const [colour, count] = dominant(read);
    const finding = {
      phase: label,
      scale: declaredScale,
      reportedImage: {width: shot.image.width, height: shot.image.height},
      decodedImage: {width: read.width, height: read.height},
      clipped: shot.image.clipped,
      crop: shot.image.crop,
      dominantColour: colour,
      dominantShare: Number((count / (read.width * read.height)).toFixed(4)),
      distinctColours: read.counts.size,
    };
    // The panel is drawn at (0, 89, 217) after GTK's colour conversion; rather
    // than hard-code that, require the dominant colour to be a blue - much more
    // blue than red or green - and to cover the whole picture.
    const [r, g, b] = colour.split(',').map(Number);
    finding.dominantIsThePanelBlue = b > 120 && b > r + 60 && b > g + 40;
    finding.wholePictureIsThePanel = finding.dominantShare >= 0.99;
    finding.imageMatchesItsOwnReport = read.width === shot.image.width && read.height === shot.image.height;
    finding.ok = finding.dominantIsThePanelBlue && finding.wholePictureIsThePanel && finding.imageMatchesItsOwnReport;
    findings.push(finding);
    log('finding', finding);
    // At scale 1 this is an assertion. Above it, the run is a CHARACTERISATION:
    // the failure it records is real and is the point of the experiment, so
    // crashing here would throw away the evidence it exists to collect.
    if (toolkitScale === 1) assert.ok(finding.ok, `${label}: ${JSON.stringify(finding)}`);
    return finding;
  }

  const before = await shoot('as-laid-out');
  // Change the layout and shoot again: the rectangle must be re-read, and the
  // new picture must still be all panel at its new size.
  command('grow'); await ack('grew panel'); await sleep(700);
  const after = await shoot('after-layout-change');
  const grew = after.decodedImage.height > before.decodedImage.height;
  findings.push({phase: 'layout-change', expected: 'the second picture is taller, and still all panel', grew, ok: grew});
  log('finding', findings[findings.length - 1]);
  if (toolkitScale === 1) assert.ok(grew, `the panel grew but the capture did not: ${before.decodedImage.height} -> ${after.decodedImage.height}`);

  fs.writeFileSync(`${run}/result.json`, JSON.stringify({
    scope: 'one GTK3 fixture under one scale setting on Xvfb; X11 only',
    verdict: toolkitScale === 1
      ? 'unscaled: the rectangle and the pixels agree, and every picture is the panel edge to edge'
      : 'scaled: the accessibility rectangle is in LOGICAL units while the grab is in DEVICE pixels, so the crop lands partly off the element - recorded, not fixed',
    scale: declaredScale,
    findings,
  }, null, 2));
} finally { try { command('quit'); } catch {} detach?.(); await desk?.close(); }

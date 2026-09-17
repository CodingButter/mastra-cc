// Validates independent calibration, not agent completion or visual review.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compositeWitness, measuredComboContainment, exactSavedBytes, validateInstalled, validatePublicSetup, sha256 } from './evidence.mjs';
const [run, installation] = process.argv.slice(2);
const json = name => JSON.parse(fs.readFileSync(path.join(run, name)));
const bytes = name => fs.readFileSync(path.join(run, name));
validateInstalled(installation);
const stages = ['initial', 'dialog', 'filled', 'replaced', 'saved', 'reopened', 'recreated-dialog'];
for (const stage of stages) validatePublicSetup(json(`${stage}-installed.json`), path.join(installation, 'consumer'));
console.log('INSTALLED_CONSUMER_GREEN');
const expected = bytes('expected.txt');
const saved = exactSavedBytes(bytes('saved.txt'), expected, 'VALUE_73', 3);
assert.deepEqual(bytes('document.txt'), expected);
assert.throws(() => exactSavedBytes(bytes('unsaved.txt'), expected, 'VALUE_73', 3), /saved bytes differ/);
const measurements = {}, rejected = [];
for (const stage of ['dialog', 'filled', 'recreated-dialog']) {
  const snapshot = json(`${stage}.native.json`);
  const witnesses = [];
  for (const node of snapshot.nodes.filter(n => n.role === 'text' && n.interfaces.includes('org.a11y.atspi.EditableText'))) {
    try { compositeWitness(snapshot, node.ref); }
    catch (error) { rejected.push({ stage, ref: node.ref, reason: error.message }); }
    try { witnesses.push(measuredComboContainment(snapshot, node.ref)); }
    catch (error) { rejected.push({ stage, ref: node.ref, measuredReason: error.message }); }
  }
  assert.deepEqual(witnesses.map(w => w.label.name).sort(), ['Replace with:', 'Search for:']);
  measurements[stage] = witnesses;
}
for (const w of measurements.dialog) {
  const after = measurements.filled.find(n => n.label.name === w.label.name);
  assert.deepEqual(after.child.ref, w.child.ref);
  assert.deepEqual(after.child.parent, w.parent.ref);
  assert.deepEqual(after.parent.children, w.parent.children);
  assert.deepEqual(w.child.relations, []);
  const fresh = measurements['recreated-dialog'].find(n => n.label.name === w.label.name);
  assert.notDeepEqual(fresh.child.ref, w.child.ref, 'reopen must not reuse stale application identity');
}
const publicReadbacks = {};
for (const stage of ['saved', 'reopened']) {
  const events = json(`${stage}-public.json`);
  const result = events.find(e => e.type === 'result' && e.result.content?.kind === 'text' && e.result.content.value === expected.toString() && events.some(c => c.type === 'call' && c.call === e.call && c.name === 'readElementContent'));
  assert.ok(result, `missing fresh ${stage} public document bytes`);
  const call = events.find(e => e.type === 'call' && e.call === result.call);
  assert.equal(call.name, 'readElementContent');
  const preceding = events.find(e => e.type === 'result' && e.call < call.call && e.result.elements?.some(n => n.id === call.arguments.id));
  assert.ok(preceding, 'readback ID must originate in preceding public result');
  publicReadbacks[stage] = { queryCall: preceding.call, readCall: call.call, id: call.arguments.id };
}
const images = [];
for (const stage of stages) for (const event of json(`${stage}-public.json`)) {
  const image = event.result?.image;
  if (!image) continue;
  const data = bytes(image.data.file);
  assert.equal(sha256(data), image.data.sha256, 'screenshot checksum mismatch');
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'not PNG');
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  assert.ok(width > 0 && height > 0);
  execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(run, image.data.file), '-f', 'null', '-'], { timeout: 10000 });
  images.push({ file: image.data.file, width, height, sha256: sha256(data) });
}
assert.ok(images.length > 0);
const video = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=width,height,nb_read_frames:format=duration', '-of', 'json', path.join(run, 'screen.mkv')], { encoding: 'utf8', timeout: 30000 }));
assert.ok(Number(video.format.duration) > 0 && Number(video.streams[0].nb_read_frames) > 0);
const report = { classification: 'EVIDENCE', saved, publicReadbacks, measurements, rejected, images, video, visualReview: 'NOT_PERFORMED: available view returned bytes; browser unavailable without display. Decode and checksum validation is not visual inspection.', agentCompletion: false };
fs.writeFileSync(path.join(run, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
console.log('EVIDENCE: independent native containment, saved bytes and public readback; visual review unavailable; no agent-completion claim');

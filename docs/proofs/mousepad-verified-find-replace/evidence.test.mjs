import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compositeWitness, measuredComboContainment, unchangedWitness, exactSavedBytes, validatePublicSetup } from './evidence.mjs';

const expected = Buffer.from('North VALUE_73 east\nVALUE_73 centre VALUE_73 south.\n');
test('independently authored saved bytes and occurrence count agree', () => {
  assert.equal(exactSavedBytes(Buffer.from(expected), expected, 'VALUE_73', 3).replacementCount, 3);
});
for (const [name, actual] of [
  ['unchanged document', 'North TOKEN_41 east\nTOKEN_41 centre TOKEN_41 south.\n'],
  ['partial replacement', 'North VALUE_73 east\nTOKEN_41 centre VALUE_73 south.\n'],
  ['extra bytes', expected.toString() + '\n'],
  ['altered surrounding text', 'South VALUE_73 east\nVALUE_73 centre VALUE_73 south.\n'],
]) test(`saved-byte oracle rejects ${name}`, () => {
  assert.throws(() => exactSavedBytes(Buffer.from(actual), expected, 'VALUE_73', 3), /saved bytes differ/);
});
test('oracle rejects a wrong declared count', () => {
  assert.throws(() => exactSavedBytes(expected, expected, 'VALUE_73', 2), /replacement count differs/);
});
test('correct in-memory text does not rescue unsaved disk bytes', () => {
  const memory = Buffer.from(expected);
  const disk = Buffer.from('North TOKEN_41 east\nTOKEN_41 centre TOKEN_41 south.\n');
  assert.deepEqual(memory, expected);
  assert.throws(() => exactSavedBytes(disk, expected, 'VALUE_73', 3), /saved bytes differ/);
});
const ref = id => [':synthetic.1', `/node/${id}`];
function fixture() {
  return { appRoot: ref('app'), nodes: [
    { ref: ref('child'), role: 'text', states: [0, 0], parent: ref('parent'), owner: ref('app'), interfaces: ['org.a11y.atspi.EditableText'], children: [] },
    { ref: ref('parent'), role: 'combo box', states: [0, 0], owner: ref('app'), children: [ref('child')], relations: [[2, [ref('label')]]] },
    { ref: ref('label'), role: 'label', states: [0, 0], owner: ref('app'), name: 'Synthetic label' },
  ] };
}
test('a strict synthetic reciprocal witness is containment, not inherited identity', () => {
  const observed = compositeWitness(fixture(), ref('child'));
  assert.equal(observed.kind, 'observed-containment-only');
  assert.equal(observed.labelText, 'Synthetic label');
  assert.equal(observed.labelObservation, undefined);
});
for (const [name, mutate, reason] of [
  ['missing parent', s => { s.nodes[0].parent = ref('missing'); }, /missing parent/],
  ['contradictory backlink', s => { s.nodes[1].children = [ref('other')]; }, /contradictory reciprocal structure/],
  ['multiple children', s => { s.nodes[1].children.push(ref('other')); }, /ambiguous composite/],
  ['nested target', s => { s.nodes[0].children.push(ref('nested')); }, /nested target/],
  ['ownership mismatch', s => { s.nodes[1].owner = ref('other-app'); }, /ownership mismatch/],
  ['protected target', s => { s.nodes[0].role = 'password text'; }, /protected target/],
  ['missing target', s => { s.nodes.shift(); }, /missing or duplicate target/],
  ['missing label', s => { s.nodes.pop(); }, /missing label/],
  ['defunct child', s => { s.nodes[0].states[0] = 1 << 6; }, /defunct or stale node/],
  ['stale parent', s => { s.nodes[1].states[0] = 1 << 27; }, /defunct or stale node/],
  ['defunct label', s => { s.nodes[2].states[0] = 1 << 6; }, /defunct or stale node/],
  ['missing state', s => { delete s.nodes[0].states; }, /missing native state/],
]) test(`synthetic witness rejects ${name}`, () => {
  const snapshot = fixture(); mutate(snapshot);
  assert.throws(() => compositeWitness(snapshot, ref('child')), reason);
});
function measuredFixture() {
  const s = fixture();
  s.nodes[1].children.push(ref('menu'));
  s.nodes.push({ ref: ref('menu'), parent: ref('parent'), owner: ref('app'), role: 'menu', states: [0, 0], interfaces: [], children: [] });
  return s;
}
test('measured menu and editable child establish only reciprocal containment', () => {
  const s = measuredFixture();
  assert.throws(() => compositeWitness(s, ref('child')), /ambiguous composite/);
  assert.equal(measuredComboContainment(s, ref('child')).kind, 'observed-containment-only');
});
for (const [name, mutate, reason] of [
  ['second editable child', s => s.nodes[3].interfaces.push('org.a11y.atspi.EditableText'), /ambiguous measured editable/],
  ['nested target', s => s.nodes[0].children.push(ref('nested')), /nested measured target/],
  ['absent parent', s => { s.nodes[0].parent = ref('absent'); }, /missing or duplicate measured node/],
  ['foreign sibling', s => { s.nodes[3].owner = ref('foreign'); }, /measured ownership mismatch/],
  ['foreign label', s => { s.nodes[2].owner = ref('foreign'); }, /measured ownership mismatch/],
  ['wrong sibling backlink', s => { s.nodes[3].parent = ref('other'); }, /measured contradictory backlink/],
  ['stale sibling', s => { s.nodes[3].states[0] = 1 << 27; }, /measured stale or defunct/],
  ['duplicate child', s => { s.nodes[1].children[1] = ref('child'); }, /duplicate measured child/],
  ['third child', s => s.nodes[1].children.push(ref('third')), /outside measured two-child shape/],
  ['protected target', s => { s.nodes[0].role = 'password text'; }, /unsupported measured target/],
  ['unknown sibling role', s => { s.nodes[3].role = 'combo box'; }, /unsupported measured sibling/],
]) test(`measured containment rejects ${name}`, () => {
  const s = measuredFixture(); mutate(s);
  assert.throws(() => measuredComboContainment(s, ref('child')), reason);
});
test('changing relationships invalidate an earlier witness', () => {
  const after = fixture(); after.nodes[2].name = 'Changed label';
  assert.throws(() => unchangedWitness(fixture(), after, ref('child')), /relationship changed/);
});
test('public setup checks require handshake, every import, and realpath containment', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mousepad-setup-control-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const consumer = path.join(root, 'consumer'); fs.mkdirSync(consumer);
  const module = path.join(consumer, 'module.mjs'); fs.writeFileSync(module, 'export {};');
  const outside = path.join(root, 'outside.mjs'); fs.writeFileSync(outside, 'export {};');
  const names = ['@mastra-cc/desktop', '@mastra-cc/desktop/mastra', '@mastra/core/agent', '@mastra-cc/protocol-types', '@mastra-cc/transport'];
  const record = { handshake: 'accepted', imports: Object.fromEntries(names.map(name => [name, module])) };
  assert.doesNotThrow(() => validatePublicSetup(record, consumer));
  assert.throws(() => validatePublicSetup({ ...record, handshake: 'rejected' }, consumer), /missing daemon handshake/);
  const missing = structuredClone(record); delete missing.imports['@mastra-cc/desktop/mastra'];
  assert.throws(() => validatePublicSetup(missing, consumer), /missing import/);
  const escaping = structuredClone(record); escaping.imports['@mastra/core/agent'] = outside;
  assert.throws(() => validatePublicSetup(escaping, consumer), /workspace or outside import/);
  const link = path.join(consumer, 'link.mjs'); fs.symlinkSync(outside, link);
  escaping.imports['@mastra/core/agent'] = link;
  assert.throws(() => validatePublicSetup(escaping, consumer), /workspace or outside import/);
});

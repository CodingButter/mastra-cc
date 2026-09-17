import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// This proves containment, not field identity. Labels remain observations of their own node.
export function compositeWitness(snapshot, ref) {
  const matches = snapshot.nodes.filter(n => same(n.ref, ref));
  assert.equal(matches.length, 1, 'missing or duplicate target');
  const child = matches[0];
  const live = node => {
    assert.ok(Array.isArray(node.states) && node.states.length === 2, 'missing native state');
    // AT-SPI StateType: DEFUNCT = 6; STALE = 27, in the first 32-bit word.
    assert.equal(node.states[0] & ((1 << 6) | (1 << 27)), 0, 'defunct or stale node');
  };
  live(child);
  assert.ok(child.interfaces.includes('org.a11y.atspi.EditableText'), 'target is not editable text');
  assert.ok(child.role !== 'password text', 'protected target');
  const parent = snapshot.nodes.find(n => same(n.ref, child.parent));
  assert.ok(parent, 'missing parent');
  live(parent);
  assert.equal(parent.role, 'combo box', 'parent is not a combo box');
  assert.ok(same(child.owner, snapshot.appRoot) && same(parent.owner, snapshot.appRoot), 'ownership mismatch');
  assert.ok(same(child.ref[0], parent.ref[0]), 'cross-bus relationship');
  assert.equal(parent.children.length, 1, 'ambiguous composite');
  assert.ok(same(parent.children[0], child.ref), 'contradictory reciprocal structure');
  assert.equal(child.children.length, 0, 'nested target');
  const labels = parent.relations.filter(r => r[0] === 2).flatMap(r => r[1]);
  assert.equal(labels.length, 1, 'ambiguous or absent direct parent label');
  const label = snapshot.nodes.find(n => same(n.ref, labels[0]));
  assert.ok(label, 'missing label');
  live(label);
  assert.ok(same(label.owner, snapshot.appRoot), 'label ownership mismatch');
  assert.equal(label.ref[0], child.ref[0], 'cross-bus label');
  assert.equal(label.role, 'label', 'unexpected label role');
  return { child: child.ref, parent: parent.ref, label: label.ref, labelText: label.name, kind: 'observed-containment-only' };
}
// A separate measured shape; the rejected single-child hypothesis above stays testable.
// This is calibration evidence only, never emitted by the product.
export function measuredComboContainment(snapshot, ref) {
  const sameRef = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const get = ref => {
    const nodes = snapshot.nodes.filter(n => sameRef(n.ref, ref));
    assert.equal(nodes.length, 1, 'missing or duplicate measured node');
    const node = nodes[0];
    assert.ok(sameRef(node.owner, snapshot.appRoot) && node.ref[0] === snapshot.appRoot[0], 'measured ownership mismatch');
    assert.ok(Array.isArray(node.states) && node.states.length === 2, 'missing measured state');
    assert.equal(node.states[0] & ((1 << 6) | (1 << 27)), 0, 'measured stale or defunct');
    return node;
  };
  const child = get(ref), parent = get(child.parent);
  assert.equal(child.role, 'text', 'unsupported measured target');
  assert.ok(child.interfaces.includes('org.a11y.atspi.EditableText'), 'missing editable interface');
  assert.equal(child.children.length, 0, 'nested measured target');
  assert.equal(parent.role, 'combo box', 'unsupported measured parent');
  assert.equal(parent.children.length, 2, 'outside measured two-child shape');
  assert.equal(new Set(parent.children.map(JSON.stringify)).size, 2, 'duplicate measured child');
  const children = parent.children.map(get);
  for (const node of children) assert.ok(sameRef(node.parent, parent.ref), 'measured contradictory backlink');
  const editable = children.filter(n => n.interfaces.includes('org.a11y.atspi.EditableText'));
  assert.equal(editable.length, 1, 'ambiguous measured editable children');
  assert.ok(sameRef(editable[0].ref, child.ref), 'measured target absent from parent');
  const sibling = children.find(n => !sameRef(n.ref, child.ref));
  assert.equal(sibling.role, 'menu', 'unsupported measured sibling');
  const labels = parent.relations.filter(r => r[0] === 2).flatMap(r => r[1]);
  assert.equal(labels.length, 1, 'missing or ambiguous measured label');
  const label = get(labels[0]);
  assert.equal(label.role, 'label', 'unsupported measured label');
  return { kind: 'observed-containment-only', child, parent, sibling, label };
}
export function unchangedWitness(before, after, ref) {
  const a = compositeWitness(before, ref), b = compositeWitness(after, ref);
  assert.deepEqual(b, a, 'relationship changed');
  return b;
}
export function exactSavedBytes(actual, expected, replacement, count) {
  assert.ok(Buffer.isBuffer(actual) && Buffer.isBuffer(expected), 'oracle requires bytes');
  assert.ok(actual.equals(expected), 'saved bytes differ');
  assert.ok(replacement.length > 0, 'empty replacement');
  const needle = Buffer.from(replacement);
  let found = 0, offset = 0;
  for (;;) {
    const at = actual.indexOf(needle, offset);
    if (at === -1) break;
    found++; offset = at + needle.length;
  }
  assert.equal(found, count, 'replacement count differs');
  return { exactBytes: true, replacementCount: found, sha256: sha256(actual) };
}
export function validateInstalled(installation) {
  const consumer = fs.realpathSync(path.join(installation, 'consumer'));
  const lock = JSON.parse(fs.readFileSync(path.join(installation, 'consumer-lock.json')));
  assert.equal(sha256(fs.readFileSync(path.join(installation, 'source-pnpm-lock.yaml'))), lock.sourceLockSha256, 'source lock mismatch');
  assert.ok(Object.keys(lock.files).length > 0, 'empty inventory');
  for (const [file, expected] of Object.entries(lock.files)) {
    assert.ok(!path.isAbsolute(file) && !file.split(path.sep).includes('..'), 'unsafe inventory path');
    const target = path.join(consumer, file);
    const real = fs.realpathSync(target);
    assert.ok(real.startsWith(consumer + path.sep), 'escaping installed path');
    if (expected.link !== undefined) assert.equal(fs.readlinkSync(target), expected.link, 'changed link');
    else assert.equal(sha256(fs.readFileSync(target)), expected.sha256, `changed installed file ${file}`);
  }
  for (const [file, expected] of Object.entries(lock.tarballs)) assert.equal(sha256(fs.readFileSync(path.join(installation, file))), expected, 'changed tarball');
  return lock;
}
export function validatePublicSetup(record, consumer) {
  assert.equal(record.handshake, 'accepted', 'missing daemon handshake');
  for (const name of ['@mastra-cc/desktop', '@mastra-cc/desktop/mastra', '@mastra/core/agent', '@mastra-cc/protocol-types', '@mastra-cc/transport']) {
    assert.ok(typeof record.imports?.[name] === 'string', `missing import ${name}`);
    assert.ok(fs.realpathSync(record.imports[name]).startsWith(fs.realpathSync(consumer) + path.sep), 'workspace or outside import');
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { labelledTargets } from './probe.mjs';
import { receiptOracle, launcherOracle, associations, inspectEvidence } from './evidence.mjs';
const run = fileURLToPath(new URL('./inspect.0GHLft/', import.meta.url));
const receipt = JSON.parse(fs.readFileSync(`${run}/receipt-native.json`));
test('retained measured wire identifies fields independently of traversal order', () => {
  const fields = associations(receipt, ['Receipt number', 'Total paid']);
  assert.ok(fields[0].bounds[1] < fields[1].bounds[1]);
  assert.ok(receipt.nodes.indexOf(fields[0]) > receipt.nodes.indexOf(fields[1]));
  associations({ ...receipt, nodes: [...receipt.nodes].reverse() }, ['Receipt number', 'Total paid']);
});
test('retained calibration and public/visual evidence are complete', () => assert.equal(inspectEvidence(run).kind, 'EVIDENCE'));
test('receipt oracle rejects missing, swapped, incorrect and extra bytes (synthetic controls)', () => {
  receiptOracle('A|12.34|\n', 'A', '12.34');
  for (const value of [undefined, '', '12.34|A|\n', 'A|12.35|\n', 'A|12.34|\nextra', 'A|12.34|']) assert.throws(() => receiptOracle(value, 'A', '12.34'));
});
test('launcher oracle rejects incorrect and extra saved bytes (synthetic controls)', () => {
  const actual = fs.readFileSync(`${run}/launcher.desktop`, 'utf8');
  launcherOracle(actual, 'Calibration launcher 7F29', 'Calibration comment 82B1');
  for (const value of ['', actual.replace('7F29', 'wrong'), actual + 'X=extra\n', actual.replace('/usr/bin/true', '/usr/bin/false')]) assert.throws(() => launcherOracle(value, 'Calibration launcher 7F29', 'Calibration comment 82B1'));
});
test('probe rejects malformed synthetic relations rather than inventing associations', () => {
  for (const value of [null, [], [[null]], [[[2, [['bus']]]]], [[['2', []]]]]) assert.throws(() => labelledTargets(value));
  assert.deepEqual(labelledTargets([[]]), []);
});
test('missing artifacts fail closed', () => assert.throws(() => inspectEvidence(`${run}/missing`)));
test('synthetic ownership and raw-wire mismatch controls fail', () => {
  const changed = structuredClone(receipt);
  changed.nodes.find(n => n.name === 'Receipt number').parent = ['other-bus', '/missing'];
  assert.throws(() => associations(changed, ['Receipt number']));
  const noWire = { ...receipt, exchanges: [] };
  assert.throws(() => associations(noWire, ['Receipt number']));
});

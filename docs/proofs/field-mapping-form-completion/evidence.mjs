import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { labelledTargets } from './probe.mjs';
export function receiptOracle(actual, receipt, total) {
  assert.equal(actual, `${receipt}|${total}|\n`, 'exact receipt bytes including order and newline');
}
export function launcherOracle(actual, name, comment) {
  assert.equal(actual, `[Desktop Entry]\nVersion=1.0\nType=Application\nName=${name}\nComment=${comment}\nExec=/usr/bin/true\nTerminal=false\nIcon=\nPath=\nStartupNotify=false\n`, 'exact saved launcher bytes; no execution or extra fields');
}
export function associations(data, expected) {
  const key = ref => JSON.stringify(ref);
  const nodes = new Map(data.nodes.map(n => [key(n.ref), n]));
  return expected.map(label => {
    const fields = data.nodes.filter(n => ['text', 'entry'].includes(n.role) && labelledTargets(n.relations).some(ref => nodes.get(key(ref))?.name === label));
    assert.equal(fields.length, 1, `unique direct text label ${label}`);
    const field = fields[0];
    assert.equal(field.name, '', 'measured ambiguous control stays unnamed');
    const wire = data.exchanges.find(e => e.request.destination === field.ref[0] && e.request.path === field.ref[1] && e.request.member === 'GetRelationSet');
    assert.deepEqual(wire?.reply, field.relations, 'parsed relation backed by raw exchange');
    for (const ref of labelledTargets(field.relations)) {
      assert.equal(ref[0], data.appRoot[0]);
      let current = ref;
      const visited = new Set();
      for (let hop = 0; key(current) !== key(data.appRoot); hop++) {
        assert.ok(hop < 16 && !visited.has(key(current)), 'bounded ownership path');
        visited.add(key(current));
        current = nodes.get(key(current))?.parent;
        assert.ok(current, 'parent present');
      }
    }
    return field;
  });
}
export function inspectEvidence(run) {
  const read = file => fs.readFileSync(`${run}/${file}`, 'utf8');
  const json = file => JSON.parse(read(file));
  associations(json('receipt-native.json'), ['Receipt number', 'Total paid']);
  associations(json('exo-native.json'), ['Name:', 'Comment:']);
  receiptOracle(read('receipt/submission.txt'), 'CALIBRATION-7F29', '123.45');
  launcherOracle(read('launcher.desktop'), 'Calibration launcher 7F29', 'Calibration comment 82B1');
  for (const app of ['receipt', 'exo']) {
    assert.ok(json(`${app}-public.json`).result.elements.length > 0);
    assert.ok(json(`${app}-confirmation-public.json`).result.elements.length > 0);
    for (const file of [`${app}.png`, `${app}-confirmation.png`, `${app}-calibration.json`]) assert.ok(fs.statSync(`${run}/${file}`).size > 0);
  }
  for (const file of ['screen.mkv', 'recording.json', 'visuals.sha256', 'exo-version.txt', 'exo-executable.sha256']) assert.ok(fs.statSync(`${run}/${file}`).size > 0);
  return { kind: 'EVIDENCE', setupCalibrationOnly: true, receiptOrder: 'receipt|total|newline', ordinaryApplication: 'exo-desktop-item-edit', modelTrials: 0 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(inspectEvidence(process.argv[2]), null, 2));

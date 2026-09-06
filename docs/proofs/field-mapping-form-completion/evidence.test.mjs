import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { labelledTargets } from './probe.mjs';
import { receiptOracle, launcherOracle, associations, inspectEvidence } from './evidence.mjs';
import { compareTrial, validateTrial, validateBatchDeclaration } from './model-evidence.mjs';
import os from 'node:os';
import path from 'node:path';
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
test('synthetic model evidence rejects unverified success and wrong mappings', () => {
  const expected={receiptNumber:'RCPT-ab123456',totalPaid:'12.34'};
  const elements=[{id:'one',labelObservation:{kind:'available',labels:['Receipt number']}},{id:'two',labelObservation:{kind:'available',labels:['Total paid']}},{id:'save',name:'Record receipt'}];
  const events=[{event:'result',name:'queryElements',call:1,result:{elements}},
    {event:'call',name:'setElementText',call:2,arguments:{id:'one',text:expected.receiptNumber}},
    {event:'call',name:'setElementText',call:3,arguments:{id:'two',text:expected.totalPaid}},
    {event:'call',name:'activateElement',call:4,arguments:{id:'save'}},
    {event:'result',name:'queryElements',call:5,result:{elements:[{name:`Receipt recorded. Submitted fields (receipt number | total paid):\n${expected.receiptNumber}|12.34|`}]}},
    {event:'model-finished',text:'Done'}];
  const actual=`${expected.receiptNumber}|12.34|\n`;
  assert.equal(compareTrial(events,'receipt',expected,actual).kind,'MACHINE_PASS');
  for(const index of [0,1,2,3,4,5]) assert.throws(()=>compareTrial(events.filter((_,i)=>i!==index),'receipt',expected,actual));
  const swapped=structuredClone(events);swapped[1].arguments.id='two';
  assert.throws(()=>compareTrial(swapped,'receipt',expected,actual));
  const prose=structuredClone(events);prose[4].event='model-text';
  assert.throws(()=>compareTrial(prose,'receipt',expected,actual));
  const discovery=structuredClone(events);discovery[4].name='discoverElements';
  discovery[4].result={entries:discovery[4].result.elements};
  assert.throws(()=>compareTrial(discovery,'receipt',expected,actual));
});
test('batch declaration rejects duplicate, missing and substituted trial kinds', () => {
  const plan = JSON.parse(fs.readFileSync(new URL('./m.CrBkmf/predeclared.json', import.meta.url)));
  validateBatchDeclaration(plan);
  for (const trials of [Array(6).fill(plan.trials[0]), plan.trials.slice(0,5), plan.trials.map(t=>({...t,kind:'receipt'})), plan.trials.map(t=>({...t,id:'../t1'}))]) {
    assert.throws(()=>validateBatchDeclaration({...plan,trials}));
  }
  const receiptRun = fileURLToPath(new URL('./m.CrBkmf/t1/', import.meta.url));
  assert.throws(()=>validateTrial(receiptRun,{kind:'ordinary'}), /declared trial kind/);
});
test('retained model runs reject incomplete artifacts, missing hashes and absent ordinary saved output', () => {
  for (const trial of ['t1','t6']) {
    const source=fileURLToPath(new URL(`./m.CrBkmf/${trial}/`,import.meta.url));
    const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'field-evidence-'));
    try {
      const files=['metadata.json','expected.json','events.jsonl','recording.json',...(trial==='t1'?['submission.txt']:['launcher.desktop','reopened-ms.txt'])];
      for(const file of files) fs.copyFileSync(`${source}/${file}`,`${temporary}/${file}`);
      assert.equal(validateTrial(temporary).kind,'MACHINE_PASS');
      for(const file of files) {
        fs.renameSync(`${temporary}/${file}`,`${temporary}/${file}.held`);
        assert.throws(()=>validateTrial(temporary),`missing ${file}`);
        fs.renameSync(`${temporary}/${file}.held`,`${temporary}/${file}`);
      }
      const metadata=JSON.parse(fs.readFileSync(`${temporary}/metadata.json`));
      metadata.artifactHashes={};fs.writeFileSync(`${temporary}/metadata.json`,JSON.stringify(metadata));
      assert.throws(()=>validateTrial(temporary),'missing artifact hashes');
    } finally {fs.rmSync(temporary,{recursive:true,force:true});}
  }
});

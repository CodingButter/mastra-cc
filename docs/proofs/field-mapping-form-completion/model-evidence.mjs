import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {receiptOracle, launcherOracle} from './evidence.mjs';
export const sha256=b=>createHash('sha256').update(b).digest('hex');
const strings = x => typeof x==='string' ? [x] : x && typeof x==='object' ? Object.values(x).flatMap(strings) : [];
export function compareTrial(events, kind, expected, actual, reopened=0) {
  assert.ok(events.some(e=>e.event==='model-finished'),'model completed');
  assert.ok(!events.some(e=>e.event==='failure'),'no model failure');
  const final=events.findIndex(e=>e.event==='model-finished');
  const observed=new Map(); const selected=[]; let submission;
  const labels=kind==='receipt' ? [['Receipt number',expected.receiptNumber],['Total paid',expected.totalPaid]] : [['Name:',expected.name],['Comment:',expected.comment]];
  for(let i=0;i<final;i++) {
    const e=events[i];
    if(e.event==='result' && e.name==='queryElements') for(const el of e.result?.elements??[]) observed.set(el.id,{element:el,call:e.call,index:i});
    if(e.event==='call' && e.name==='setElementText') {
      const witness=observed.get(e.arguments.id);
      assert.ok(witness,'selected ID was publicly observed');
      const matches=labels.filter(([label,value])=>witness.element.labelObservation?.kind==='available' && witness.element.labelObservation.labels.includes(label) && value===e.arguments.text);
      assert.equal(matches.length,1,'entered value matches explicit label evidence');
      selected.push({label:matches[0][0],value:e.arguments.text,id:e.arguments.id,labelCall:witness.call,actionCall:e.call,index:i});
    }
    if(e.event==='call' && ['activateElement','clickElement','submitElement'].includes(e.name)) {
      const name=observed.get(e.arguments.id)?.element.name;
      if((kind==='receipt' && name==='Record receipt') || (kind==='ordinary' && name==='Save')) submission={call:e.call,index:i,time:e.time};
    }
  }
  for(const [label] of labels) assert.ok(selected.some(s=>s.label===label),'both fields explicitly mapped');
  assert.ok(submission,'recorded submission action');
  assert.ok(selected.every(s=>s.index<submission.index),'field writes precede submit');
  const later=events.slice(submission.index+1,final).filter(e=>e.event==='result' && ['queryElements','readElementContent'].includes(e.name));
  let verification;
  if(kind==='receipt') {
    receiptOracle(actual,expected.receiptNumber,expected.totalPaid);
    for(const e of later) for(const text of strings(e.result)) {
      const match=/Submitted fields \(receipt number \| total paid\):\n([^\n]+)/.exec(text);
      if(match) {receiptOracle(match[1]+'\n',expected.receiptNumber,expected.totalPaid);verification={call:e.call,time:e.time,actual:match[1]+'\n'};}
    }
  } else {
    launcherOracle(actual,expected.name,expected.comment);
    assert.ok(reopened>submission.time,'saved app reopened for readback');
    for(const e of later.filter(e=>e.time>=reopened)) {
      if(labels.every(([label,value])=>(e.result?.elements??[]).some(el=>el.labelObservation?.kind==='available' && el.labelObservation.labels.includes(label) && el.content?.value===value))) verification={call:e.call,time:e.time,actual:{name:expected.name,comment:expected.comment}};
    }
  }
  assert.ok(verification,'fresh post-submit public actual-value verification before final text');
  return {kind:'MACHINE_PASS',selected,submission,verification,finalEvent:final};
}
export function validateBatchDeclaration(plan) {
  assert.ok(Array.isArray(plan.trials), 'predeclared trials required');
  assert.equal(plan.trials.length, 6, 'six predeclared trials required');
  assert.equal(new Set(plan.trials.map(t => t.id)).size, 6, 'distinct trial IDs required');
  for (const [index, trial] of plan.trials.entries()) {
    assert.match(trial.id, /^t[1-6]$/, 'bounded trial directory required');
    assert.equal(trial.kind, index < 5 ? 'receipt' : 'ordinary', 'five receipts followed by one ordinary trial required');
  }
}
export function validateTrial(run,{review=false,kind:declaredKind}={}) {
  const json=p=>JSON.parse(fs.readFileSync(`${run}/${p}`,'utf8'));
  const metadata=json('metadata.json');
  assert.equal(metadata.model,'google/gemini-2.5-flash');assert.equal(metadata.temperature,0);assert.equal(metadata.maxSteps,24);
  assert.match(metadata.instructionsSha256,/^[a-f0-9]{64}$/);assert.ok(Object.keys(metadata.artifactHashes).length>=8);
  for(const hash of Object.values(metadata.artifactHashes)) assert.match(hash,/^[a-f0-9]{64}$/);
  const kind=fs.existsSync(`${run}/launcher.desktop`)?'ordinary':'receipt';
  if (declaredKind !== undefined) assert.equal(kind, declaredKind, 'declared trial kind matches evidence');
  const expected=json('expected.json');
  const events=fs.readFileSync(`${run}/events.jsonl`,'utf8').trim().split('\n').map(JSON.parse);
  const result=compareTrial(events,kind,expected,fs.readFileSync(`${run}/${kind==='receipt'?'submission.txt':'launcher.desktop'}`,'utf8'),kind==='ordinary'?Number(fs.readFileSync(`${run}/reopened-ms.txt`,'utf8')):0);
  assert.ok(Number(json('recording.json').format.duration)>0,'recording finalized');
  if(review) {
    const r=json('review.json');assert.equal(r.visualReviewed,true);assert.equal(r.comparisonReviewed,true);
    assert.equal(r.eventsSha256,sha256(fs.readFileSync(`${run}/events.jsonl`)));
    assert.equal(r.recordingSha256,sha256(fs.readFileSync(`${run}/screen.mkv`)));
    for(const stage of ['before-fill','before-submit','after-confirmation']) {
      const checkpoint=r.checkpoints.find(c=>c.stage===stage);assert.ok(checkpoint,'all visual stages reviewed');
      assert.equal(checkpoint.sha256,sha256(fs.readFileSync(`${run}/${checkpoint.file}`)));
    }
    result.kind='GREEN';
  }
  return result;
}

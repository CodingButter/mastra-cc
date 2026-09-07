import {fixture as traceFixture} from './model-evidence.test.mjs';
import {RATE_POLICY} from './model-rate.mjs';
import {validateVisual, reviewBatch, digest} from './model-review.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compositeWitness, measuredComboContainment, unchangedWitness, exactSavedBytes, validatePublicSetup } from './evidence.mjs';

function batchFixture(t) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'mousepad-batch-test-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const root=`${base}/root`,batch=`${base}/batch`,consumer=`${batch}/installed/consumer`;
  const put=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
  const save=(file,value)=>put(file,JSON.stringify(value));
  fs.mkdirSync(`${root}/docs/proofs/mousepad-verified-find-replace`,{recursive:true});
  const files=['daemon/dist/main.mjs','protocol/schema.json','pnpm-lock.yaml','packages/desktop/instructions/AGENT-INSTRUCTIONS.md','docs/proofs/mousepad-verified-find-replace/model-review.mjs','docs/proofs/mousepad-verified-find-replace/model-driver.mjs','docs/proofs/mousepad-verified-find-replace/model-rate.mjs'];
  const artifacts=Object.fromEntries(files.map(file=>{put(`${root}/${file}`,'synthetic '+file);return [file,digest(fs.readFileSync(`${root}/${file}`))];}));
  for(const file of ['model-driver.mjs','model-rate.mjs']) put(`${consumer}/${file}`,fs.readFileSync(`${root}/docs/proofs/mousepad-verified-find-replace/${file}`));
  put(`${consumer}/module.mjs`,'synthetic module');put(`${batch}/installed/consumer-lock.json`,'{}');
  const settings={model:'google/gemini-2.5-flash',temperature:0,maxSteps:24,modelDeadlineMs:180000};
  const trials=['t1','t2','t3'].map(id=>{
    const dir=`${batch}/${id}`,segments=['North ','\n',' middle ',' south\n'],source='SOURCE',replacement='VALUE';
    const before=segments.join(source),expected=segments.join(replacement);
    const trial={id,kind:'mousepad-literal-replacement',count:3,source,replacement,segments,beforeSha256:digest(Buffer.from(before)),expectedSha256:digest(Buffer.from(expected))};
    save(`${dir}/trial.json`,trial);put(`${dir}/before.txt`,before);put(`${dir}/expected.txt`,expected);put(`${dir}/document.txt`,expected);
    const events=[{event:'model-started',time:2000},...traceFixture()];events.forEach((e,i)=>e.sequence=i+1);put(`${dir}/events.jsonl`,events.map(e=>JSON.stringify(e)).join('\n'));
    save(`${dir}/metadata.json`,{...settings,consumer,handshake:'accepted',instructionsSha256:artifacts[files[3]],imports:Object.fromEntries(['@mastra-cc/desktop','@mastra-cc/desktop/mastra','@mastra/core/agent','@mastra-cc/transport','@mastra-cc/protocol-types'].map(n=>[n,`${consumer}/module.mjs`]))});
    save(`${dir}/attempt.json`,{code:0,reason:null});return trial;
  });
  const declaration={created:1000,artifacts,trials,...settings,consumerLockSha256:digest(Buffer.from('{}'))};save(`${batch}/declaration.json`,declaration);
  return {root,batch,save,declaration};
}
test('three synthetic machine passes remain REVIEW_PENDING without reviews',t=>{const {root,batch}=batchFixture(t);const result=reviewBatch(batch,root);assert.equal(result.verdict,'REVIEW_PENDING');assert.ok(result.results.every(r=>r.machine==='GREEN'&&r.independentOracle==='GREEN'&&r.humanApproval==='PENDING'));});
test('predeclared Anthropic trials still require visual review and reject mixed models',t=>{
 const f=batchFixture(t);const model='anthropic/claude-sonnet-4-5-20250929';
 f.declaration.model=model;f.save(`${f.batch}/declaration.json`,f.declaration);
 for(const id of ['t1','t2','t3']) {const file=`${f.batch}/${id}/metadata.json`;f.save(file,{...JSON.parse(fs.readFileSync(file)),model});}
 assert.equal(reviewBatch(f.batch,f.root).verdict,'REVIEW_PENDING');
 const file=`${f.batch}/t2/metadata.json`;f.save(file,{...JSON.parse(fs.readFileSync(file)),model:'google/gemini-2.5-flash'});
 assert.throws(()=>reviewBatch(f.batch,f.root));
});
test('32-step experiment remains bounded, declared and requires post-save readback',t=>{
 const f=batchFixture(t);f.declaration.maxSteps=32;f.save(`${f.batch}/declaration.json`,f.declaration);
 assert.throws(()=>reviewBatch(f.batch,f.root));
 for(const id of ['t1','t2','t3']) {const file=`${f.batch}/${id}/metadata.json`;f.save(file,{...JSON.parse(fs.readFileSync(file)),maxSteps:32});}
 assert.equal(reviewBatch(f.batch,f.root).verdict,'REVIEW_PENDING');
 const journal=`${f.batch}/t1/events.jsonl`,events=fs.readFileSync(journal,'utf8').split('\n').map(JSON.parse);
 const reads=events.filter(e=>e.event==='call'&&e.name==='queryElements'&&e.call>5).map(e=>e.call);
 const without=events.filter(e=>!reads.includes(e.call));without.forEach((e,i)=>e.sequence=i+1);fs.writeFileSync(journal,without.map(e=>JSON.stringify(e)).join('\n'));
 assert.throws(()=>reviewBatch(f.batch,f.root),/fresh document/);
});
for(const maxSteps of [0,25,33,Infinity,'32',null])test(`reject unapproved step budget ${maxSteps}`,t=>{
 const f=batchFixture(t);f.declaration.maxSteps=maxSteps;f.save(`${f.batch}/declaration.json`,f.declaration);
 assert.throws(()=>reviewBatch(f.batch,f.root),/unapproved step budget/);
});
test('paced policy must be predeclared and match every trial',t=>{
 const f=batchFixture(t);f.declaration.model='anthropic/claude-sonnet-4-5-20250929';f.declaration.ratePolicy=RATE_POLICY;f.save(`${f.batch}/declaration.json`,f.declaration);
 for(const id of ['t1','t2','t3']) {const file=`${f.batch}/${id}/metadata.json`;f.save(file,{...JSON.parse(fs.readFileSync(file)),model:f.declaration.model,ratePolicy:RATE_POLICY});const journal=`${f.batch}/${id}/events.jsonl`;const events=fs.readFileSync(journal,'utf8').split('\n').map(JSON.parse);events.splice(1,0,{event:'provider-request',time:2001,startedMs:0,attempt:0,bytes:100});events.forEach((e,i)=>e.sequence=i+1);fs.writeFileSync(journal,events.map(e=>JSON.stringify(e)).join('\n'));}
 assert.equal(reviewBatch(f.batch,f.root).verdict,'REVIEW_PENDING');
 const file=`${f.batch}/t2/metadata.json`;f.save(file,{...JSON.parse(fs.readFileSync(file)),ratePolicy:null});
 assert.throws(()=>reviewBatch(f.batch,f.root),/rate policy mismatch/);
 f.declaration.ratePolicy={...RATE_POLICY,retries:99};f.save(`${f.batch}/declaration.json`,f.declaration);
 assert.throws(()=>reviewBatch(f.batch,f.root),/unapproved rate policy/);
});
test('matching but unapproved model names cannot pass declaration validation',t=>{
 const f=batchFixture(t);f.declaration.model='unapproved/model';f.save(`${f.batch}/declaration.json`,f.declaration);
 for(const id of ['t1','t2','t3']) {const file=`${f.batch}/${id}/metadata.json`;f.save(file,{...JSON.parse(fs.readFileSync(file)),model:f.declaration.model});}
 assert.throws(()=>reviewBatch(f.batch,f.root));
});
for(const [name,mutate] of [
 ['modified executed driver',f=>fs.appendFileSync(`${f.batch}/installed/consumer/model-driver.mjs`,'changed')],
 ['modified executed rate helper',f=>fs.appendFileSync(`${f.batch}/installed/consumer/model-rate.mjs`,'changed')],
 ['stale runtime',f=>fs.appendFileSync(`${f.root}/daemon/dist/main.mjs`,'changed')],
 ['stale instructions',f=>fs.appendFileSync(`${f.root}/packages/desktop/instructions/AGENT-INSTRUCTIONS.md`,'changed')],
 ['stale harness',f=>fs.appendFileSync(`${f.root}/docs/proofs/mousepad-verified-find-replace/model-review.mjs`,'changed')],
 ['missing artifact hash',f=>{delete f.declaration.artifacts['daemon/dist/main.mjs'];f.save(`${f.batch}/declaration.json`,f.declaration);}],
 ['wrong actual kind',f=>f.save(`${f.batch}/t1/trial.json`,{...f.declaration.trials[0],kind:'receipt'})],
 ['wrong count',f=>{f.declaration.trials[0].count=2;f.save(`${f.batch}/declaration.json`,f.declaration);f.save(`${f.batch}/t1/trial.json`,f.declaration.trials[0]);}],
 ['mutated saved bytes',f=>fs.appendFileSync(`${f.batch}/t1/document.txt`,'bad')],
 ['UI-only unsaved success',f=>fs.copyFileSync(`${f.batch}/t1/before.txt`,`${f.batch}/t1/document.txt`)],
 ['failed attempt',f=>f.save(`${f.batch}/t1/attempt.json`,{code:1,reason:null})],
 ['workspace import',f=>{const file=`${f.batch}/t1/metadata.json`,m=JSON.parse(fs.readFileSync(file));m.imports['@mastra/core/agent']=`${f.root}/daemon/dist/main.mjs`;f.save(file,m);}],
]) test(`batch rejects ${name}`,t=>{const f=batchFixture(t);mutate(f);assert.throws(()=>reviewBatch(f.batch,f.root));});

function reviewFixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mousepad-review-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const trial={id:'t1',source:'SOURCE',replacement:'VALUE'};
  for(const file of ['events.jsonl','trial.json','document.txt','screen.mkv','pre.png','filled.png','result.png','verified.png']) {
    fs.writeFileSync(path.join(dir,file),`SYNTHETIC TEST ONLY ${file}`);fs.utimesSync(path.join(dir,file),1,1);
  }
  fs.writeFileSync(`${dir}/session-ended-ms.txt`,'1000');
  const record=file=>({path:file,sha256:digest(fs.readFileSync(path.join(dir,file)))});
  const review={trialId:'t1',reviewer:'SYNTHETIC VALIDATOR FIXTURE, NOT ACTUAL INSPECTION',inspectedAt:new Date(2000).toISOString(),eventsSha256:record('events.jsonl').sha256,trialSha256:record('trial.json').sha256,savedSha256:record('document.txt').sha256,verificationCall:6,limitations:[],recording:record('screen.mkv'),checkpoints:['pre-action','filled','result','verified'].map((stage,i)=>({...record(['pre.png','filled.png','result.png','verified.png'][i]),stage,comparison:'synthetic comparison',matches:true,searchValue:'SOURCE',replacementValue:'VALUE',evidenceCall:6}))};
  return {dir,review,trial};
}
test('visual record validates independently hashed synthetic fixture, never writes review.json',t=>{
  const {dir,review,trial}=reviewFixture(t);assert.equal(validateVisual(dir,review,{verification:6},trial),'COMPLETE');assert.ok(!fs.existsSync(`${dir}/review.json`));
});
for(const [name,mutate] of [
  ['missing recording',r=>delete r.recording],['missing checkpoints',r=>r.checkpoints.pop()],
  ['missing hash',r=>delete r.checkpoints[0].sha256],['mismatched hash',r=>r.recording.sha256='0'.repeat(64)],
  ['review before capture',r=>r.inspectedAt=new Date(500).toISOString()],['wrong trial',r=>r.trialId='t2'],
  ['wrong journal hash',r=>r.eventsSha256='0'.repeat(64)],['wrong saved hash',r=>r.savedSha256='0'.repeat(64)],
  ['wrong verification call',r=>r.verificationCall=99],['missing comparison',r=>r.checkpoints[0].comparison=''],
  ['wrong field value',r=>r.checkpoints[1].searchValue='WRONG'],['unresolved limitation',r=>r.limitations=['unreadable']],
  ['aliased checkpoint',r=>Object.assign(r.checkpoints[1],{path:r.checkpoints[0].path,sha256:r.checkpoints[0].sha256})],
]) test(`visual validator rejects ${name}`,t=>{const {dir,review,trial}=reviewFixture(t);mutate(review);assert.throws(()=>validateVisual(dir,review,{verification:6},trial));});
test('recording bytes are rehashed rather than trusting supplied hash',t=>{const {dir,review,trial}=reviewFixture(t);fs.appendFileSync(`${dir}/screen.mkv`,'mutated');assert.throws(()=>validateVisual(dir,review,{verification:6},trial),/hash mismatch/);});
for(const [name,ids] of [['duplicate IDs',['t1','t1','t3']],['wrong trial count',['t1','t2']]]) test(`batch rejects ${name}`,t=>{
  const {dir}=reviewFixture(t);fs.writeFileSync(`${dir}/declaration.json`,JSON.stringify({trials:ids.map(id=>({id}))}));assert.throws(()=>reviewBatch(dir,dir),/three distinct/);
});
test('batch rejects aliased directories',t=>{const {dir}=reviewFixture(t);fs.mkdirSync(`${dir}/t1`);fs.symlinkSync(`${dir}/t1`,`${dir}/t2`);fs.mkdirSync(`${dir}/t3`);fs.writeFileSync(`${dir}/declaration.json`,JSON.stringify({trials:['t1','t2','t3'].map(id=>({id}))}));assert.throws(()=>reviewBatch(dir,dir),/aliased/);});

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

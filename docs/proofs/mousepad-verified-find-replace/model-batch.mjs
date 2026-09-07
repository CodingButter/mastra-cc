import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { artifactBytes, runTrials } from './model-supervisor.mjs';
import { fileURLToPath } from 'node:url';
const here=fileURLToPath(new URL('.',import.meta.url)), root=path.resolve(here,'../../..');
const hash=b=>createHash('sha256').update(b).digest('hex');
const save=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const batch=path.resolve(process.argv[3]??fs.mkdtempSync('/tmp/mousepad-model.'));
if(process.argv[2]==='--review') {
  try {
    assert.ok(process.argv[3], 'review requires an existing batch directory');
    const {reviewBatch}=await import('./model-review.mjs');
    const report=reviewBatch(batch,root);console.log(JSON.stringify(report,null,2));
    process.exit(report.verdict==='GREEN'?0:2);
  } catch(error) {console.error(`INVALID: ${error.message}`);process.exit(1);}
}
assert.equal(process.argv[2],'--run','use --run [fresh-directory]');
fs.mkdirSync(batch,{recursive:true});
assert.ok(!fs.existsSync(`${batch}/declaration.json`),'never reuse an attempt');
const install=`${batch}/installed`;
execFileSync('node',[`${here}/install-consumer.mjs`,install],{cwd:root,stdio:'inherit',timeout:180000});
fs.copyFileSync(`${here}/model-driver.mjs`,`${install}/consumer/model-driver.mjs`);
const files=['daemon/dist/main.mjs','protocol/schema.json','pnpm-lock.yaml','packages/desktop/instructions/AGENT-INSTRUCTIONS.md',...fs.readdirSync(here).filter(f=>/\.(mjs|sh)$/.test(f)).map(f=>path.relative(root,path.join(here,f)))];
const artifacts=Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
const segments=[['North harbour: ','\nEast orchard: ','\nSouth ridge: ','.\n'],['Birch ledger [',']\nCedar ledger [',']\nElm ledger [',']\n'],['Morning record — ','\nNoon record — ','\nEvening record — ','\n']];
const trials=segments.map((parts,i)=>{
  const id=`t${i+1}`, source=`TOKEN_${randomBytes(5).toString('hex')}`, replacement=`VALUE_${randomBytes(5).toString('hex')}`;
  const dir=`${batch}/${id}`;fs.mkdirSync(dir);
  fs.writeFileSync(`${dir}/before.txt`,parts.join(source));fs.writeFileSync(`${dir}/expected.txt`,parts.join(replacement));
  fs.writeFileSync(`${dir}/task.txt`,`In the open Mousepad document, use Find and Replace to replace all three literal occurrences of ${source} with ${replacement}. Preserve all other text. Save the document and verify its resulting text with fresh UI evidence before reporting success. Use literal, case-sensitive matching over the whole document, not regular expressions. Keep UTF-8 encoding and existing newlines.\n`);
  const trial={id,kind:'mousepad-literal-replacement',source,replacement,count:3,segments:parts,beforeSha256:hash(fs.readFileSync(`${dir}/before.txt`)),expectedSha256:hash(fs.readFileSync(`${dir}/expected.txt`))};save(`${dir}/trial.json`,trial);return trial;
});
save(`${batch}/declaration.json`,{created:Date.now(),hypothesis:process.env.MOUSEPAD_HYPOTHESIS??'Initial fixed-settings installed-consumer completion measurement',artifacts,trials,consumerLockSha256:hash(fs.readFileSync(`${install}/consumer-lock.json`)),model:'google/gemini-2.5-flash',temperature:0,maxSteps:24,modelDeadlineMs:180000});
console.log(`PREDECLARED: ${batch} t1 t2 t3`);
const started=performance.now();
const attempts=await runTrials(trials.map(trial=>`${batch}/${trial.id}`),dir=>({
  command:'bash',args:[`${here}/model-session.sh`,'--display',dir,`${install}/consumer`],cwd:root,inspect:()=>{
    if(performance.now()-started>900000)return 'batch-timeout';
    if(artifactBytes(dir)>256*1024*1024)return 'trial-size-limit';
    if(trials.reduce((sum,t)=>sum+artifactBytes(`${batch}/${t.id}`),0)>1024*1024*1024)return 'batch-size-limit';
    return null;
  }
}));
try { save(`${batch}/attempts.json`,attempts); }
catch(error) { console.error(JSON.stringify({verdict:'INVALID',reason:'batch-evidence-write-error',detail:error.code??error.message,attempts})); process.exit(1); }
for(const [i,outcome] of attempts.entries())console.log(`${trials[i].id}: ${outcome.category}; saved bytes ${outcome.exactSavedBytes?'match':'do not match'}; cleanup ${outcome.cleanupVerified?'verified':'UNVERIFIED'}`);
for(const [f,sha] of Object.entries(artifacts))assert.equal(hash(fs.readFileSync(path.join(root,f))),sha,`artifact changed: ${f}`);
const rejected=attempts.some(attempt=>attempt.reason || attempt.code!==0 || !attempt.exactSavedBytes);
console.log(rejected?'REJECTED: failed or invalid trial; retain all attempts':'REVIEW_PENDING: capture is not completion proof');process.exitCode=rejected?1:2;

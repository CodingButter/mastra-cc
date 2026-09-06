import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateTrial,sha256} from './model-evidence.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const write=(p,x)=>fs.writeFileSync(p,JSON.stringify(x,null,2)+'\n');
function size(p) {return fs.readdirSync(p,{withFileTypes:true}).reduce((n,e)=>n+(e.isSymbolicLink()?0:e.isDirectory()?size(path.join(p,e.name)):fs.statSync(path.join(p,e.name)).size),0);}
if(process.argv[2]==='--review') {
  const batch=path.resolve(process.argv[3]);const plan=JSON.parse(fs.readFileSync(`${batch}/predeclared.json`));
  if(plan.trials.length!==6) throw new Error('six predeclared trials required');
  for(const t of plan.trials) write(`${batch}/${t.id}/ledger.json`,validateTrial(`${batch}/${t.id}`,{review:true}));
  write(`${batch}/outcome.json`,{kind:'GREEN',receiptTrials:5,ordinaryTrials:1});console.log('PROOF: GREEN — five receipts and one ordinary app, reviewed');
} else {
  const batch=fs.mkdtempSync(`${here}/m.`);console.log(`BATCH=${batch}`);
  const trials=Array.from({length:6},(_,i)=>({id:`t${i+1}`,kind:i<5?'receipt':'ordinary'}));
  write(`${batch}/predeclared.json`,{created:new Date().toISOString(),hypothesis:process.env.PROOF_HYPOTHESIS??'Explicit native labels permit field mapping and fresh public confirmation verification.',commit:execFileSync('git',['rev-parse','HEAD'],{cwd:here,encoding:'utf8'}).trim(),trials,batchDeadlineMs:1800000,killGraceMs:15000,trialDeadlineMs:240000,trialBytes:268435456,batchBytes:2147483648,harnessHashes:Object.fromEntries(['model-batch.mjs','model-session.sh','model-driver.mjs','model-evidence.mjs'].map(f=>[f,sha256(fs.readFileSync(`${here}/${f}`))]))});
  const started=Date.now();const outcomes=[];
  for(const trial of trials) {
    const run=`${batch}/${trial.id}`;fs.mkdirSync(run);
    if(trial.kind==='ordinary') {
      const expected={name:`Launcher-${randomBytes(5).toString('hex')}`,comment:`Comment-${randomBytes(5).toString('hex')}`};
      write(`${run}/expected.json`,expected);
      fs.writeFileSync(`${run}/task.txt`,`In the Edit Launcher window, change Name to ${expected.name} and Comment to ${expected.comment}. Leave all other settings unchanged. Save the launcher, then verify the saved values. The editor will reopen for saved-state inspection. Do not launch it.\n`);
    }
    const log=fs.openSync(`${run}/session.log`,'wx');
    const child=spawn('bash',[`${here}/model-session.sh`,'--display',run,trial.kind],{detached:true,stdio:['ignore',log,log]});fs.closeSync(log);
    let invalid;let grace;
    const stop=reason=>{if(invalid)return;invalid=reason;try{process.kill(-child.pid,'SIGTERM');}catch{}grace=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},15000);};
    const timer=setTimeout(()=>stop('INVALID_TIMEOUT'),Math.min(240000,1800000-(Date.now()-started)));
    const monitor=setInterval(()=>{if(size(run)>268435456 || size(batch)>2147483648)stop('INVALID_RESOURCE');},250);
    const code=await new Promise(resolve=>child.on('exit',resolve));clearTimeout(timer);clearInterval(monitor);
    // A private process group includes readback app descendants; never target unrelated PIDs.
    try{process.kill(-child.pid,'SIGTERM');}catch{}
    if(grace) {await new Promise(r=>setTimeout(r,1000));try{process.kill(-child.pid,'SIGKILL');}catch{}clearTimeout(grace);}
    let result;
    try {
      if(invalid) throw new Error(invalid);
      if(code!==0) throw new Error('INVALID_OR_MODEL_FAILURE: inspect retained events and logs');
      if(trial.kind==='receipt') fs.writeFileSync(`${run}/oracle.txt`,execFileSync(process.execPath,[`${here}/../model-desktop-task-2026-09-06/verify.mjs`,run],{encoding:'utf8'}));
      result=validateTrial(run);write(`${run}/ledger.json`,result);
    } catch(error) {result={kind:invalid??'FAIL',error:String(error)};}
    outcomes.push({id:trial.id,...result});write(`${batch}/outcomes.json`,outcomes);console.log(`${trial.id}: ${result.kind}`);
    if(result.kind!=='MACHINE_PASS') {write(`${batch}/outcome.json`,{kind:result.kind,attempted:outcomes.length,remaining:'NOT_RUN: batch stopped'});process.exitCode=1;break;}
  }
  if(outcomes.length===6 && outcomes.every(o=>o.kind==='MACHINE_PASS')) {write(`${batch}/outcome.json`,{kind:'REVIEW_PENDING',attempted:6});console.log('PROOF: REVIEW_PENDING — no GREEN until checkpoint and comparison review');process.exitCode=2;}
}

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { connect } from '/opt/mastra-cc/transport/index.mjs';
for (const mode of ['cancel', 'timeout', 'early-exit', 'malformed']) {
  writeFileSync('/tmp/authorized-failure-mode', mode);
  try { unlinkSync('/tmp/authorized-failure-pids'); } catch (error) { if(error.code!=='ENOENT') throw error; }
  const client=await connect({socketPath:process.env.MASTRA_CC_SOCKET});
  const {elements}=await client.queryElements({limit:1000});
  const target=elements.find(e=>e.name==='Solid capture target');
  assert(target);
  const started=performance.now();
  const request=client.captureElement({id:target.id}).then(result=>({result}),error=>({error}));
  let ids;
  for(let i=0;i<100;i++) {
    try { ids=readFileSync('/tmp/authorized-failure-pids','utf8').trim().split(' ').map(Number); if(ids.length===3 && ids.every(n=>n>0)) break; } catch {}
    await sleep(20);
  }
  assert(ids?.length===3,'failure helper did not start');
  if(mode==='cancel') await client.close();
  const outcome=await request;
  if(mode==='cancel') assert(outcome.error,'disconnect must reject pending request');
  else {
    assert(outcome.result?.refusal,JSON.stringify(outcome));
    assert(!outcome.result.image);
    assert.equal(outcome.result.refusal.code,mode==='timeout'?'UnperformableElementError':'BackendUnreadable');
  }
  let members=[];
  for(let i=0;i<150;i++) {
    members=readdirSync('/proc').filter(n=>/^\d+$/.test(n)).filter(n=>{
      try { const fields=readFileSync(`/proc/${n}/stat`,'utf8').split(') ')[1].split(' '); return Number(fields[2])===ids[2]; } catch { return false; }
    });
    if(!members.length && ids.slice(0,2).every(pid=>!existsSync(`/proc/${pid}/fd`))) break;
    await sleep(20);
  }
  assert.deepEqual(members,[],'residual failure-helper process group');
  assert(ids.slice(0,2).every(pid=>!existsSync(`/proc/${pid}/fd`)),'residual descriptors');
  const elapsed=performance.now()-started;
  assert(elapsed<14000);
  if(mode==='timeout') assert(elapsed>=9500);
  console.log(`CLEANUP ${mode}: no image; leader, descendant and FDs gone; ${Math.round(elapsed)}ms`);
  await client.close();
}

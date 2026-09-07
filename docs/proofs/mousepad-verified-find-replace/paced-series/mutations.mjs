import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const file=new URL('../model-rate.mjs',import.meta.url),test=new URL('../model-rate.test.mjs',import.meta.url);
const original=fs.readFileSync(file,'utf8');
const changes=[['no pacing','intervalMs:3000','intervalMs:0'],['no bound','attempt>=RATE_POLICY.retries','attempt>=99'],['ignore server delay','Number.isFinite(hint)?hint:0','0'],['replay non-rate failures','response.status!==429','response.status===200'],['discard cache','body.cache_control={type:RATE_POLICY.cache};',''],['ignore deadline','abort.throwIfAborted();',''],['retry too early','if(delay>RATE_POLICY.maxWaitMs) return response;','if(delay>RATE_POLICY.maxWaitMs) next=0;']];
try {
 for(const [name,before,after] of changes){if(!original.includes(before))throw Error('missing mutation');fs.writeFileSync(file,original.replaceAll(before,after));const r=spawnSync(process.execPath,['--test',test.pathname],{encoding:'utf8',timeout:10000});fs.writeFileSync(file,original);if(r.error || r.status!==1 || !/fail [1-9]/.test(r.stdout))throw Error(`${name}: no valid red test`);console.log(`${name}: RED`);}
 const r=spawnSync(process.execPath,['--test',test.pathname],{encoding:'utf8',timeout:10000});if(r.status!==0)throw Error('restored tests failed');console.log(`GREEN: ${changes.length} mutations caught; source restored; tests pass`);
}finally{fs.writeFileSync(file,original);}

import fs from 'node:fs';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {MastraCC} from '@mastra-cc/desktop/mastra';
// Cancellation ownership, measured natively. The driver connection owns
// cancellation: closing it is the request. The daemon acknowledges by stopping
// the running effect at its next emitted-key boundary and retiring ownership;
// the successor connection observes the acknowledgement as the first effect
// it is admitted to issue. Latency here = close requested (driver clock) to
// successor admitted (same clock), polling-inclusive; the daemon's own
// settle line is retained beside it for cross-checking.
const run=process.argv[2];
const log=(event,data={})=>fs.appendFileSync(`${run}/cancel-events.jsonl`,JSON.stringify({event,monotonicMs:performance.now(),...data})+'\n');
globalThis.fetch=async()=>{throw Error('model/network calls forbidden');};
const FILL='cancel measurement '.repeat(53).padEnd(1024,'x'); // 1024 characters, the clear cap: measured ~0.35 ms per emitted Backspace, so ~350 ms of emissions
let address;
for(let i=0;i<80;i++){const match=/websocket listening on (127\.0\.0\.1:\d+)/.exec(fs.existsSync(`${run}/daemon.log`)?fs.readFileSync(`${run}/daemon.log`,'utf8'):'');if(match){address=`ws://${match[1]}`;break;}await sleep(200);}
assert.ok(address,'daemon ready');
async function connection(label){const desk=new MastraCC({url:address});await desk.client();const tools=desk.getTools();return {label,desk,async call(name,args){const result=await tools[name].execute(args);log('tool',{label,name,args:{...args,text:args.text?`${args.text.length} chars`:undefined},result:{refusal:result.refusal,content:result.content?.value?.length??result.element?.content?.value?.length}});return result;},close:()=>desk.close()};}
let document;
{const setup=await connection('discover');
 for(let i=0;i<40;i++){const found=await setup.call('queryElements',{application:'mousepad',limit:500});document=found.elements?.find(e=>e.role==='text'&&e.content?.kind==='text');if(document)break;await sleep(200);}
 await setup.close();}
assert.ok(document,'native text document found');
const samples=[];
for(let index=0;index<5;index++){
 const fill=await connection(`fill-${index}`);const filled=await fill.call('setElementText',{id:document.id,text:FILL});assert.ok(!filled.refusal,filled.refusal);await fill.close();await sleep(150);
 const driver=await connection(`driver-${index}`);
 const issuedMs=performance.now();log('clear-issued',{index});
 const clearing=driver.call('clearElementText',{id:document.id}).catch(error=>({error:String(error)}));
 await sleep(120);
 const closeRequestedMs=performance.now();log('close-requested',{index});
 await driver.close();
 const successor=await connection(`successor-${index}`);
 let admittedMs,refusals=0;const deadline=performance.now()+10000;
 while(performance.now()<deadline){const answer=await successor.call('revealElement',{id:document.id});if(!answer.refusal){admittedMs=performance.now();break;}assert.match(answer.refusal,/another driver/);refusals++;}
 assert.ok(admittedMs,'successor admitted after the driver closed');
 // Two readings, because the acknowledgement and the last emitted key are
 // different moments: keys the registry already accepted keep landing in the
 // application after ownership has retired. The first reading is what a
 // successor sees the instant it is admitted; the second, after the keys
 // have settled, is what the daemon actually emitted.
 const atAdmission=(await successor.call('readElementContent',{id:document.id,offset:0,limit:4096})).content.value.length;
 await sleep(500);
 const settledRead=(await successor.call('readElementContent',{id:document.id,offset:0,limit:4096})).content.value.length;
 await successor.close();const cleared=await clearing;
 const sample={index,fillLength:FILL.length,remainingAtAdmission:atAdmission,remainingSettled:settledRead,deletedSettled:FILL.length-settledRead,keysStillLandingAtAdmission:atAdmission-settledRead,issuedMs,closeRequestedMs,admittedMs,closeToAdmittedUpperBoundMs:admittedMs-closeRequestedMs,refusalsBeforeAdmission:refusals,driverCallOutcome:cleared.error?'connection closed':(cleared.refusal??'completed')};
 assert.ok(settledRead>0&&settledRead<FILL.length,`clear was still in flight at close: ${settledRead} of ${FILL.length} remain`);
 samples.push(sample);log('sample',sample);await sleep(200);
}
await sleep(300);
const daemonLog=fs.readFileSync(`${run}/daemon.log`,'utf8');
const stopped=[...daemonLog.matchAll(/clearElementText stopped at a supported boundary after (\d+) of (\d+) emissions/g)].map(m=>({emitted:+m[1],of:+m[2]}));
const settled=[...daemonLog.matchAll(/driver (\d+) settled ([\d.]+) ms after its connection closed mid-effect/g)].map(m=>({generation:+m[1],settleMs:+m[2]}));
assert.equal(stopped.length,samples.length,'one boundary stop per sample');assert.equal(settled.length,samples.length,'one settle acknowledgement per sample');
assert.ok(daemonLog.includes('failed in the backend')===false,'no sample was logged as a backend failure');
samples.forEach((sample,i)=>{sample.daemonEmittedAtStop=stopped[i].emitted;sample.daemonPlannedEmissions=stopped[i].of;sample.daemonSettleMs=settled[i].settleMs;
 // Each emitted Backspace removed one character: the daemon's count of what it
 // could not retract is exactly what the fresh readback found missing.
 assert.equal(stopped[i].emitted,sample.deletedSettled,`daemon emitted ${stopped[i].emitted}, document lost ${sample.deletedSettled} once settled`);});
const ms=samples.map(s=>s.closeToAdmittedUpperBoundMs).sort((a,b)=>a-b);
fs.writeFileSync(`${run}/cancel-result.json`,JSON.stringify({scope:'native Mousepad clear cancelled by closing the driver connection; acknowledgement observed as successor admission (polling-inclusive upper bound) and as the daemon settle line; no model calls',samples,closeToAdmittedMs:{min:ms[0],median:ms[Math.floor(ms.length/2)],max:ms[ms.length-1]},keysStillLandingAtAdmission:{min:Math.min(...samples.map(s=>s.keysStillLandingAtAdmission)),max:Math.max(...samples.map(s=>s.keysStillLandingAtAdmission))},daemonSettleMs:{min:Math.min(...settled.map(s=>s.settleMs)),max:Math.max(...settled.map(s=>s.settleMs))}},null,2));
console.log(`PROOF: GREEN — ${samples.length} native clears stopped at a key boundary; close→successor admitted ${ms[0]}/${ms[Math.floor(ms.length/2)]}/${ms[ms.length-1]} ms`);

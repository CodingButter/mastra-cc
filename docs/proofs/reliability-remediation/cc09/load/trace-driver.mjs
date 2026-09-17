// Records what a real Mousepad session emits: every native change event the
// daemon forwards, with a monotonic receipt time, under two workloads a person
// would recognise - typing a paragraph key by key, and a burst of whole-text
// replacements. No model, no Mastra agent: the trace is the daemon's own
// change stream, and the inter-arrival gaps in it are the distribution the
// replay uses. Nothing here is a claim about production usage; it is one
// desk, one editor, two workloads, recorded rather than invented.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {MastraCC} from '@mastra-cc/desktop/mastra';
const run=process.argv[2];
const log=(event,data={})=>fs.appendFileSync(`${run}/trace.jsonl`,JSON.stringify({event,monotonicMs:performance.now(),...data})+'\n');
let desk,detach;
globalThis.fetch=async()=>{throw Error('model/network calls forbidden');};
const PARAGRAPH='The quick brown fox jumps over the lazy dog while the daemon counts each key it forwards. '.repeat(4).trim();
try {
 let address;
 for(let i=0;i<80;i++){const match=/websocket listening on (127\.0\.0\.1:\d+)/.exec(fs.existsSync(`${run}/daemon.log`)?fs.readFileSync(`${run}/daemon.log`,'utf8'):'');if(match){address=`ws://${match[1]}`;break;}await sleep(250);}
 assert.ok(address,'daemon ready');desk=new MastraCC({url:address});const client=await desk.client(),tools=desk.getTools();
 async function call(name,args){const result=await tools[name].execute(args);log('tool',{name,args:{...args,text:args.text?`<${args.text.length} chars>`:undefined}});assert.ok(!result.refusal,result.refusal);return result;}
 let document;
 for(let i=0;i<40;i++){const apps=await call('listApplications',{});if(apps.applications.some(a=>a.name.toLowerCase()==='mousepad'&&a.running==='answering')){const found=await call('queryElements',{application:'mousepad',limit:500});document=found.elements.find(e=>e.role==='text');if(document)break;}await sleep(250);}
 assert.ok(document,'native text document found');
 let received=0;
 detach=client.onChangeEvent(event=>{received++;log('native-receipt',{subscriptionId:event.subscriptionId,id:event.id,kind:event.kind,attribution:event.attribution,priority:event.priority});});
 const subscription=await call('subscribeElement',{id:document.id,priority:'medium'});
 const subscriptionId=subscription.subscription?.subscriptionId;assert.ok(subscriptionId);
 // Workload A: a paragraph typed as keys. typeText is the daemon's verified
 // per-key path, so each character is a real emission the editor answers.
 log('workload-start',{workload:'typing',chars:PARAGRAPH.length});
 await call('setElementText',{id:document.id,text:''});
 await sleep(300);
 const typingFrom=received;
 await call('typeText',{id:document.id,text:PARAGRAPH});
 await sleep(1500);
 log('workload-end',{workload:'typing',receipts:received-typingFrom});
 const typed=await call('readElementContent',{id:document.id,offset:0,limit:4096});
 assert.equal(typed.content.value,PARAGRAPH,'the paragraph landed exactly');
 // Workload B: thirty whole-text replacements back to back, the shape a
 // replace-all or a paste storm gives the change stream.
 log('workload-start',{workload:'replacement-burst',count:30});
 const burstFrom=received;
 for(let i=0;i<30;i++)await call('setElementText',{id:document.id,text:`Replacement ${i}: ${PARAGRAPH.slice(0,80)}\n`});
 await sleep(1500);
 log('workload-end',{workload:'replacement-burst',receipts:received-burstFrom});
 const last=await call('readElementContent',{id:document.id,offset:0,limit:4096});
 assert.equal(last.content.value,`Replacement 29: ${PARAGRAPH.slice(0,80)}\n`,'the last replacement landed exactly');
 await call('unsubscribeElement',{subscriptionId});
 fs.writeFileSync(`${run}/trace-result.json`,JSON.stringify({scope:'native Mousepad change events received by one client under two recorded workloads; one desk, not production usage',receipts:received,typingChars:PARAGRAPH.length,replacements:30},null,2));
}finally{detach?.();await desk?.close();}

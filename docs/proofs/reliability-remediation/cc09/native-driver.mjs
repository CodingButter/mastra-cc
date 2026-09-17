import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {MastraCC} from '@mastra-cc/desktop/mastra';
const run=process.argv[2], r=createRequire(process.env.CC09_MASTRA_ENTRY);
const {Agent}=r('@mastra/core/agent'), {Mastra}=r('@mastra/core'), {LibSQLStore}=r('@mastra/libsql'), {Memory}=r('@mastra/memory');
const log=(event,data={})=>fs.appendFileSync(`${run}/native-events.jsonl`,JSON.stringify({event,monotonicMs:performance.now(),...data})+'\n');
let desk,provider,detach,fetchCalls=0;
globalThis.fetch=async()=>{fetchCalls++;throw Error('model/network calls forbidden');};
try {
 let address;
 for(let i=0;i<80;i++){const match=/websocket listening on (127\.0\.0\.1:\d+)/.exec(fs.existsSync(`${run}/daemon.log`)?fs.readFileSync(`${run}/daemon.log`,'utf8'):'');if(match){address=`ws://${match[1]}`;break;}await sleep(200);}
 assert.ok(address,'daemon ready');desk=new MastraCC({url:address});const client=await desk.client(),tools=desk.getTools();
 async function call(name,args){const result=await tools[name].execute(args);log('tool',{name,args,result});assert.ok(!result.refusal,result.refusal);return result;}
 let document;
 for(let i=0;i<40;i++){const apps=await call('listApplications',{});if(apps.applications.some(a=>a.name.toLowerCase()==='mousepad'&&a.running==='answering')){const found=await call('queryElements',{application:'mousepad',limit:500});document=found.elements.find(e=>e.role==='text'&&e.content?.kind==='text');if(document)break;}await sleep(200);}
 assert.ok(document,'native text document found');
 const target={threadId:'cc09-native',resourceId:'cc09-native'};
 provider=desk.getSignalProvider(target,{deliver:['unattributed','self'],dedupeWindowMs:0});
 const store=new LibSQLStore({id:'cc09-native',url:`file:${run}/notifications.db`});
 const agent=new Agent({id:'cc09-native',name:'native measurement',instructions:'No generation permitted.',model:'google/gemini-2.5-flash',signals:[provider],memory:new Memory({storage:store}),notifications:{deliveryPolicy:{decide:()=> 'persist'}}});
 const mastra=new Mastra({agents:{agent},storage:store});await (await agent.getMemory()).createThread(target);
 const domain=await mastra.getStorage().getStore('notifications');
 const events=[];detach=client.onChangeEvent(event=>{events.push({receivedMs:performance.now(),event});log('native-receipt',{change:event});});await provider.start();
 const samples=[];
 for(let index=0;index<10;index++){
  const subscription=await call('subscribeElement',{id:document.id,priority:'high'});const subscriptionId=subscription.subscription?.subscriptionId;assert.ok(subscriptionId,'unique subscription correlation');
  const text=`CC09 native measurement ${index}\n`,injectionStartMs=performance.now();log('injection-start',{index,subscriptionId});
  await call('setElementText',{id:document.id,text});
  let row,received;
  const deadline=performance.now()+10000;
  while(performance.now()<deadline){const rows=await domain.listNotifications({threadId:target.threadId});row=rows.find(item=>item.attributes?.subscriptionId===subscriptionId&&item.sourceId===document.id);received=events.find(item=>item.event.subscriptionId===subscriptionId&&item.event.id===document.id&&item.receivedMs>=injectionStartMs&&item.event.at===row?.attributes?.at);if(row&&received)break;await sleep(5);}
  const persistedObservedMs=performance.now();assert.ok(row&&received,'native event reached persistent storage');assert.equal(row.status,'pending');assert.equal(row.deliveryAttempts,0);assert.equal(row.attributes.attribution,received.event.attribution);assert.equal(row.attributes.at,received.event.at);
  const read=await call('readElementContent',{id:document.id,offset:0,limit:4096});assert.equal(read.content.value,text);
  const sample={index,subscriptionId,id:document.id,notificationId:row.id,injectionStartMs,eventReceivedMs:received.receivedMs,persistedObservedMs,injectionToStorageUpperBoundMs:persistedObservedMs-injectionStartMs,receiptToStorageUpperBoundMs:persistedObservedMs-received.receivedMs};samples.push(sample);log('sample',sample);
  await call('unsubscribeElement',{subscriptionId});await sleep(100);
 }
 assert.equal(fetchCalls,0);fs.writeFileSync(`${run}/native-result.json`,JSON.stringify({scope:'native Mousepad mutation through daemon and DesktopSignals to SQLite; polling-inclusive upper bounds, not intrinsic native-event latency or cancellation acknowledgement',fetchCalls,samples},null,2));console.log('PROOF: GREEN — ten correlated native mutations persisted without model calls');
}finally{provider?.stop();detach?.();await desk?.close();}

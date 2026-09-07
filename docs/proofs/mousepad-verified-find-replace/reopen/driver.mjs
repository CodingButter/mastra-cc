import fs from 'node:fs';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {MastraCC} from '@mastra-cc/desktop/mastra';
const run=process.argv[2],declaration=JSON.parse(fs.readFileSync(`${run}/reopen-declaration.json`));let desk,sequence=0;
const log=(event,data)=>fs.appendFileSync(`${run}/reopen-events.jsonl`,JSON.stringify({sequence:++sequence,time:Date.now(),event,...data})+'\n');
try {
 let address;for(let i=0;i<80;i++){const m=/websocket listening on (127\.0\.0\.1:\d+)/.exec(fs.existsSync(`${run}/daemon.log`)?fs.readFileSync(`${run}/daemon.log`,'utf8'):'');if(m){address=`ws://${m[1]}`;break;}await sleep(200);}assert.ok(address);
 desk=new MastraCC({url:address});await desk.client();const tools=desk.getTools();
 async function call(name,args){log('call',{name,args});try{const result=await tools[name].execute(args);log('result',{name,result});assert.ok(!result.refusal,result.refusal);return result;}catch(error){log('error',{name,message:error.message});throw error;}}
 let ready=false;for(let i=0;i<40;i++){const apps=await call('listApplications',{});if(apps.applications.some(a=>a.name.toLowerCase()==='mousepad'&&a.running==='answering')){ready=true;break;}await sleep(200);}assert.ok(ready,'Mousepad became publicly discoverable');
 async function query(){return (await call('queryElements',{application:'mousepad',limit:500})).elements;}
 let elements;for(let i=0;i<40;i++){elements=await query();if(elements.some(e=>e.role==='text'))break;await sleep(200);}
 const initial=elements.find(e=>e.role==='text');assert.ok(initial);assert.notEqual(initial.content?.value,declaration.expected,'fresh process must not already display expected content');
 const open=elements.find(e=>e.role==='button'&&e.name.trim()==='Open...');assert.ok(open,'observed Open button');try{await call('activateElement',{id:open.id,action:'click'});}catch(error){log('uncertain-open',{message:error.message,replayed:false});}
 elements=await query();fs.writeFileSync(`${run}/chooser.json`,JSON.stringify(elements,null,2));
 const location=elements.find(e=>['text','textbox'].includes(e.role)&&/Location|Name|File name/i.test(e.name));assert.ok(location,'observed filename/location input');
 await call('setElementText',{id:location.id,text:declaration.source});await call('sendKeyChord',{id:location.id,chord:'Enter'});
 let document;for(let i=0;i<40;i++){elements=await query();document=elements.find(e=>['text','textbox'].includes(e.role)&&e.content?.kind==='text'&&e.content.value===declaration.expected);if(document)break;await sleep(200);}assert.ok(document,'reopened document visible with exact text');
 const read=await call('readElementContent',{id:document.id,offset:0,limit:4096});assert.equal(read.content?.kind,'text');assert.equal(read.content.value,declaration.expected);log('verified',{source:declaration.source,id:document.id});console.log('GREEN: original saved document opened through public tools in fresh native process; exact fresh readback');
}finally{await desk?.close();}

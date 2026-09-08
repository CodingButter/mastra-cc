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
 const file=elements.find(e=>e.role==='menu'&&e.name==='File');assert.ok(file,'observed File menu');await call('activateElement',{id:file.id,action:file.actions[0].name});elements=await query();
 const open=elements.find(e=>e.role==='menuitem'&&e.name.trim()==='Open...');assert.ok(open,'observed Open menu item');await call('clickElement',{id:open.id,button:'left',count:1});
 let observed=false;for(let i=0;i<5;i++){try{elements=await query();observed=true;break;}catch(error){log('read-retry',{attempt:i+1,message:error.message});await sleep(200);}}assert.ok(observed,'fresh public chooser observation');fs.writeFileSync(`${run}/chooser.json`,JSON.stringify(elements,null,2));
 const chooser=elements.find(e=>e.role==='dialog'&&e.name==='Open File');assert.ok(chooser,'observed Open File dialog');elements=(await call('queryElements',{application:'mousepad',window:chooser.name,limit:500})).elements;fs.writeFileSync(`${run}/chooser-scoped.json`,JSON.stringify(elements,null,2));
 const widget=elements.find(e=>e.actions?.some(a=>a.name==='show_location'));assert.ok(widget,'observed chooser location action');await call('activateElement',{id:widget.id,action:'show_location'});elements=(await call('queryElements',{application:'mousepad',window:chooser.name,limit:500})).elements;fs.writeFileSync(`${run}/location.json`,JSON.stringify(elements,null,2));
 const locations=elements.filter(e=>['text','textbox'].includes(e.role)&&e.states.includes('focused')&&!e.states.includes('offscreen'));assert.equal(locations.length,1,'unique focused input revealed by show_location');const location=locations[0];
 await call('setElementText',{id:location.id,text:declaration.source});await call('sendKeyChord',{id:location.id,chord:'Enter'});
 let document;for(let i=0;i<40;i++){elements=await query();document=elements.find(e=>['text','textbox'].includes(e.role)&&e.content?.kind==='text'&&e.content.value===declaration.expected);if(document)break;await sleep(200);}assert.ok(document,'reopened document visible with exact text');
 const read=await call('readElementContent',{id:document.id,offset:0,limit:4096});assert.equal(read.content?.kind,'text');assert.equal(read.content.value,declaration.expected);log('verified',{source:declaration.source,id:document.id});console.log('GREEN: original saved document opened through public tools in fresh native process; exact fresh readback');
}finally{await desk?.close();}

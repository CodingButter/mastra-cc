import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// Execute the actual driver body with boundary dependencies stubbed; no network or desktop.
const source=fs.readFileSync(new URL('../model-driver.mjs',import.meta.url),'utf8')
 .replace(/^import .*;\n/gm,'').replaceAll('import.meta.resolve(name)','resolveModule(name)').replaceAll('import.meta.url','moduleUrl');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function run(maxSteps){
 const state={generated:null,metadata:null,closed:false,timers:[]};
 const disk={realpathSync:p=>p.replace(/\/$/,''),existsSync:()=>true,
  readFileSync:p=>p.endsWith('declaration.json')?JSON.stringify({model:'google/gemini-2.5-flash',maxSteps}):p.endsWith('daemon.log')?'websocket listening on 127.0.0.1:1234':'test task',
  writeFileSync:(p,s)=>{if(p.endsWith('metadata.json'))state.metadata=JSON.parse(s);},appendFileSync:()=>{}};
 class Desk {async client(){} getTools(){return {queryElements:{execute:async()=>({elements:[{}]})}};}async close(){state.closed=true;}}
 class Agent {async generate(task,options){state.generated=options;return {text:'done',finishReason:'stop'};}}
 const process={argv:['node','driver','/run'],env:{GOOGLE_API_KEY:'not-a-real-key'}};
 const names=['assert','fs','fileURLToPath','createHash','sleep','MastraCC','INSTRUCTIONS','Agent','RATE_POLICY','pacedFetch','process','globalThis','AbortController','setTimeout','clearTimeout','resolveModule','moduleUrl'];
 await new AsyncFunction(...names,source)(assert,disk,fileURLToPath,createHash,async()=>{},Desk,'instructions',Agent,null,()=>assert.fail('unexpected pacing'),process,{fetch:()=>assert.fail('unexpected network')},AbortController,(f,ms)=>{state.timers.push(ms);return 1;},()=>{},()=> 'file:///tmp/driver-budget-test/module.mjs','file:///tmp/driver-budget-test/model-driver.mjs');
 return {...state,exitCode:process.exitCode};
}
for(const maxSteps of [24,32])test(`driver forwards declared ${maxSteps} budget and unchanged deadline`,async()=>{
 const r=await run(maxSteps);assert.equal(r.generated.maxSteps,maxSteps);assert.equal(r.metadata.maxSteps,maxSteps);assert.deepEqual(r.timers,[180000]);assert.equal(r.metadata.modelDeadlineMs,180000);assert.equal(r.closed,true);assert.equal(r.exitCode,undefined);
});
test('driver refuses undeclared budget before generation',async()=>{const r=await run(33);assert.equal(r.generated,null);assert.equal(r.exitCode,1);});

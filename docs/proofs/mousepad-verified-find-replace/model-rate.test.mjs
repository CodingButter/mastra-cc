import test from 'node:test';
import assert from 'node:assert/strict';
import {pacedFetch,RATE_POLICY} from './model-rate.mjs';
const url='https://api.anthropic.com/v1/messages';
const init={method:'POST',body:JSON.stringify({model:'test',messages:[{role:'user',content:'unchanged'}]})};
function fixture(responses=[200], controller=new AbortController()) {
 let time=0;const calls=[],records=[],pauses=[];
 const run=pacedFetch(async request=>{calls.push({time,body:await request.text()});const r=responses.shift()??200;return new Response('response',{status:typeof r==='number'?r:r.status,headers:r.headers});},{signal:controller.signal,now:()=>time,wallNow:()=>0,wait:async(ms,s)=>{s.throwIfAborted();pauses.push(ms);time+=ms;},record:(event,data)=>records.push({event,...data})});
 return {run,calls,records,pauses,controller};
}
test('paces consecutive and concurrent requests, preserves messages and adds caching',async()=>{
 const f=fixture();await Promise.all([f.run(url,init),f.run(url,init),f.run(url,init)]);
 assert.deepEqual(f.calls.map(x=>x.time),[0,3000,6000]);
 for(const call of f.calls)assert.deepEqual(JSON.parse(call.body),{...JSON.parse(init.body),cache_control:{type:'ephemeral'}});
 assert.equal(f.records.filter(x=>x.event==='provider-request').length,3);
});
test('retries only 429 with identical body and honors Retry-After seconds',async()=>{
 const f=fixture([{status:429,headers:{'retry-after':'7'}},200]);assert.equal((await f.run(url,init)).status,200);
 assert.deepEqual(f.calls.map(x=>x.time),[0,7000]);assert.equal(f.calls[0].body,f.calls[1].body);
 assert.equal(f.records[1].delayMs,7000);
});
test('honors HTTP-date Retry-After and refuses excessive delay rather than retrying early',async()=>{
 const f=fixture([{status:429,headers:{'retry-after':new Date(9000).toUTCString()}},200]);await f.run(url,init);assert.equal(f.calls[1].time,9000);
 const g=fixture([{status:429,headers:{'retry-after':'31'}}]);assert.equal((await g.run(url,init)).status,429);assert.equal(g.calls.length,1);
});
test('retry count bounded and invalid hints use finite backoff',async()=>{
 const f=fixture(Array(4).fill({status:429,headers:{'retry-after':'invalid'}}));assert.equal((await f.run(url,init)).status,429);assert.equal(f.calls.length,RATE_POLICY.retries+1);assert.deepEqual(f.calls.map(x=>x.time),[0,3000,6000]);
});
test('does not replay success or non-rate HTTP failure',async()=>{
 for(const status of [200,400,401,500]) {const f=fixture([status]);assert.equal((await f.run(url,init)).status,status);assert.equal(f.calls.length,1);}
});
test('aborted and queued calls cannot reach fetch',async()=>{
 const f=fixture();f.controller.abort();await assert.rejects(f.run(url,init),{name:'AbortError'});await new Promise(setImmediate);assert.equal(f.calls.length,0);
 const c=new AbortController();let calls=0;const run=pacedFetch(async()=>{calls++;return new Response('',{status:429});},{signal:c.signal,now:()=>0,wait:async(ms,s)=>{c.abort();s.throwIfAborted();}});
 await assert.rejects(run(url,init),{name:'AbortError'});assert.equal(calls,1);
});
test('queued Request abort rejects while predecessor remains unresolved',{timeout:1000},async()=>{
 let finish,entered;const began=new Promise(resolve=>entered=resolve);let calls=0;
 const run=pacedFetch(async request=>{calls++;assert.equal(request.headers.get('x-api-key'),'fixture');assert.equal(request.headers.get('content-length'),null);entered();return new Promise(resolve=>finish=resolve);});
 const first=run(new Request(url,{...init,headers:{'x-api-key':'fixture','content-length':'1'}}));await began;
 const controller=new AbortController();const queued=run(new Request(url,{...init,signal:controller.signal}));controller.abort();
 await assert.rejects(queued,{name:'AbortError'});assert.equal(calls,1);finish(new Response('ok'));await first;
});
test('in-flight Request signal is forwarded and abort does not retry',{timeout:1000},async()=>{
 let entered;const began=new Promise(resolve=>entered=resolve);let calls=0;const c=new AbortController();
 const run=pacedFetch(async request=>{calls++;entered();return new Promise((resolve,reject)=>request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true}));});
 const pending=run(new Request(url,{...init,signal:c.signal}));await began;c.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,1);
});
test('unrelated fetches pass through untouched',async()=>{
 const original={method:'POST',body:'raw'};let args;const run=pacedFetch(async(...a)=>{args=a;return new Response('ok');});await run('https://example.com/data',original);assert.deepEqual(args,['https://example.com/data',original]);
});
test('selected tool set retains inspection, visual capture, mutation and saved readback',()=>{
 for(const name of ['queryElements','readElementContent','setElementText','activateElement','sendKeyChord','captureElement'])assert.ok(RATE_POLICY.tools.includes(name));assert.equal(new Set(RATE_POLICY.tools).size,RATE_POLICY.tools.length);
});

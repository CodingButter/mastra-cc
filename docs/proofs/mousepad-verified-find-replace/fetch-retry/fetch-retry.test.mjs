import test from 'node:test';
import assert from 'node:assert/strict';
import {pacedFetch,RATE_POLICY} from '../model-rate.mjs';
const url='https://api.anthropic.com/v1/messages';
const init={method:'POST',headers:{'content-type':'application/json','x-api-key':'fake'},body:JSON.stringify({messages:[]})};
function clock(){let now=0;return {now:()=>now,wait:async(ms,s)=>{s.throwIfAborted();now+=ms;}};}
test('fetch rejection retries identical provider request before response only',async()=>{
 const requests=[],events=[],c=clock();const fetch=pacedFetch(async r=>{requests.push({body:await r.text(),headers:[...r.headers],at:c.now()});if(requests.length===1)throw new TypeError('socket closed');return new Response('ok');},{...c,record:(event,data)=>events.push({event,...data})});
 assert.equal(await (await fetch(url,init)).text(),'ok');assert.equal(requests.length,2);assert.equal(requests[0].body,requests[1].body);assert.deepEqual(requests[0].headers,requests[1].headers);assert.ok(requests[1].at-requests[0].at>=RATE_POLICY.intervalMs);assert.equal(events.filter(e=>e.event==='provider-fetch-retry').length,1);
});
test('fetch errors and 429 share one finite attempt budget',async()=>{
 let calls=0;const controller=new AbortController(),error=new TypeError('socket closed');const fetch=pacedFetch(async()=>{calls++;if(calls>3)controller.abort(new Error('attempt bound violated'));if(calls===2)return new Response('',{status:429});throw error;},{...clock(),signal:controller.signal});
 await assert.rejects(fetch(url,init),e=>e===error);assert.equal(calls,3);
});
test('abort during network retry wait sends no additional request',async()=>{
 const controller=new AbortController();let calls=0;const fetch=pacedFetch(async()=>{calls++;throw new TypeError('socket closed');},{signal:controller.signal,now:()=>0,wait:async(ms,s)=>{controller.abort(new Error('original deadline'));s.throwIfAborted();}});
 await assert.rejects(fetch(url,init),/original deadline/);assert.equal(calls,1);
});
test('request abort during pending fetch keeps original reason and sends once',async()=>{
 const controller=new AbortController(),reason=new Error('request cancelled');let calls=0,rejectFetch,started;const ready=new Promise(resolve=>{started=resolve;});
 const fetch=pacedFetch(async()=>{calls++;started();return new Promise((resolve,reject)=>{rejectFetch=reject;});},clock());
 const pending=fetch(url,{...init,signal:controller.signal});await ready;controller.abort(reason);rejectFetch(new TypeError('socket closed'));await assert.rejects(pending,e=>e===reason);await new Promise(setImmediate);assert.equal(calls,1);
});
test('response body failure is never replayed',async()=>{
 let calls=0;const fetch=pacedFetch(async()=>{calls++;return new Response(new ReadableStream({start(c){c.error(new Error('stream failed'));}}));},clock());
 const response=await fetch(url,init);await assert.rejects(response.text(),/stream failed/);assert.equal(calls,1);
});
test('non-rate HTTP failures and other origins are not retried',async()=>{
 let calls=0;const fetch=pacedFetch(async()=>{calls++;return new Response('',{status:500});},clock());assert.equal((await fetch(url,init)).status,500);assert.equal(calls,1);
 let other=0;const foreign=pacedFetch(async()=>{other++;throw new Error('foreign failure');},clock());await assert.rejects(foreign('https://example.com',init));assert.equal(other,1);
});

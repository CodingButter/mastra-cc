import {setTimeout as sleep} from 'node:timers/promises';

export const RATE_POLICY = Object.freeze({intervalMs:3000, retries:2, maxWaitMs:30000, cache:'ephemeral', tools:['listApplications','queryElements','discoverElements','readElementContent','attestElement','activateElement','setElementText','setElementCaret','revealElement','sendKeyChord','captureElement']});

// Only the isolated driver installs this transport. Never replay agent/tool calls.
export function pacedFetch(fetch, {signal, record=()=>{}, now=()=>performance.now(), wallNow=()=>Date.now(), wait=(ms,s)=>sleep(ms,undefined,{signal:s})}={}) {
  let next=0, queue=Promise.resolve();
  return async (input, init) => {
    const url=new URL(typeof input==='string' || input instanceof URL ? input : input.url);
    if(url.origin!=='https://api.anthropic.com' || url.pathname!=='/v1/messages') return fetch(input,init);
    const request=new Request(input,init);
    if(request.method!=='POST') return fetch(input,init);
    const abort=signal ? AbortSignal.any([signal,request.signal]) : request.signal;
    const run=async()=>{
      abort.throwIfAborted();
      const body=JSON.parse(await request.clone().text());
      body.cache_control={type:RATE_POLICY.cache};
      const text=JSON.stringify(body);
      const headers=new Headers(request.headers);headers.delete('content-length');
      for(let attempt=0; ;attempt++) {
        abort.throwIfAborted();
        while(next>now()) {await wait(next-now(),abort);abort.throwIfAborted();}
        abort.throwIfAborted(); const startedMs=now();next=startedMs+RATE_POLICY.intervalMs;
        record('provider-request',{attempt,bytes:Buffer.byteLength(text),startedMs});
        const response=await fetch(new Request(request,{body:text,headers,signal:abort}));
        if(response.status!==429 || attempt>=RATE_POLICY.retries) return response;
        const header=response.headers.get('retry-after');
        const hint=header===null ? 0 : /^\d+(\.\d+)?$/.test(header) ? Number(header)*1000 : Date.parse(header)-wallNow();
        const delay=Math.max(1000*2**attempt,Number.isFinite(hint)?hint:0);
        // Do not retry earlier than the server asks, or extend the trial deadline.
        if(delay>RATE_POLICY.maxWaitMs) return response;
        await response.body?.cancel();
        record('provider-backoff',{attempt,delayMs:delay});
        next=Math.max(next,now()+delay);
      }
    };
    const result=queue.then(run); queue=result.catch(()=>{});
    return new Promise((resolve,reject)=>{
      const clean=()=>abort.removeEventListener('abort',cancel);
      const cancel=()=>{clean();reject(abort.reason);};
      abort.addEventListener('abort',cancel,{once:true});
      if(abort.aborted) cancel();
      result.then(value=>{clean();resolve(value);},error=>{clean();reject(error);});
    });
  };
}

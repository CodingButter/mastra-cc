import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {setTimeout as sleep} from 'node:timers/promises';
import {SignalThrottle,SIGNAL_RETENTION_LIMIT} from '../../../../packages/desktop/src/signal-throttle.ts';

const source=new URL('../../../../packages/desktop/src/signal-throttle.ts',import.meta.url);
console.log(JSON.stringify({kind:'environment',node:process.version,platform:process.platform,sourceSha256:createHash('sha256').update(readFileSync(source)).digest('hex'),boundary:'producer ingress to synchronous delivery callback; not native event to stored notification or native cancellation'}));
const quantile=(values,q)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*q))]:null;
for(const config of [{name:'unthrottled-burst',gap:0,count:1000,keys:1000},{name:'hot-key-burst',gap:250,count:1000,keys:1},{name:'overflow-burst',gap:1000,count:10000,keys:10000},{name:'long-gap-hot-key',gap:1750,count:1000,keys:1}]) {
 const histogram=monitorEventLoopDelay({resolution:10});histogram.enable();await sleep(25);
 const ingress=[],latencies=[];let overflow=0,peak=0,delivered=0;
 const throttle=new SignalThrottle(config.gap,(event,broad)=>{delivered++;if(broad)overflow++;latencies.push(performance.now()-event.at);});
 let row;
 try {
  const start=performance.now();
  for(let i=0;i<config.count;i++) {
   const at=performance.now();throttle.push({subscriptionId:`sub-${i%config.keys}`,id:'el-0123456789ab',role:'textbox',kind:'changed',attribution:'external',priority:'low',at});ingress.push(performance.now()-at);
   peak=Math.max(peak,throttle.retainedCount);assert.ok(peak<=SIGNAL_RETENTION_LIMIT+1);
  }
  const burstMs=performance.now()-start;
  await sleep(Math.max(config.gap+100,1100));
  const retainedBeforeStop=throttle.retainedCount,stopStart=performance.now();throttle.stop();const producerStopMs=performance.now()-stopStart;
  const deliveredAtStop=delivered;assert.equal(throttle.retainedCount,0);
  throttle.push({subscriptionId:'after-stop',id:'el-0123456789ab',role:'textbox',kind:'changed',attribution:'external',priority:'low',at:performance.now()});await sleep(1100);assert.equal(delivered,deliveredAtStop);
  assert.ok(delivered>0);assert.ok(latencies.every(n=>Number.isFinite(n)&&n>=0));
  if(config.gap===0)assert.equal(delivered,config.count);
  row={kind:'measurement',...config,burstMs,ingressMs:{p50:quantile(ingress,.5),p95:quantile(ingress,.95),max:Math.max(...ingress)},deliveryMs:{p50:quantile(latencies,.5),p95:quantile(latencies,.95),max:Math.max(...latencies)},delivered,overflow,peakRetainedPointers:peak,retainedBeforeStop,retainedAfterStop:throttle.retainedCount,producerStopMs,eventLoopMs:{p95:histogram.percentile(95)/1e6,max:histogram.max/1e6},postStopObservationMs:1100};
 }finally{throttle.stop();histogram.disable();}
 console.log(JSON.stringify(row));
}
console.log(JSON.stringify({verdict:'GREEN',claim:'four producer-only real-clock workloads measured, retention bounded, local stop observed; no end-to-end notification or native cancellation claim'}));

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { MastraCC, INSTRUCTIONS } from '../../../packages/desktop/dist/mastra.mjs';
const require = createRequire(new URL('../../../apps/desk-demo/package.json', import.meta.url));
const { Agent } = require('@mastra/core/agent');
const run = process.argv[2];
const kind = process.argv[3];
const hash = b => createHash('sha256').update(b).digest('hex');
const task = kind === 'receipt' ? 'Read the receipt shown in the Receipt transfer window. Put the receipt number into Receipt number and its printed total into Total paid, then press Record receipt. Verify the result.' : fs.readFileSync(`${run}/task.txt`, 'utf8');
const secrets = Object.entries(process.env).filter(([k,v]) => /API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(k) && v.length > 12).map(([,v]) => v);
let image = 0;
function safe(data) {
  let text = JSON.stringify(data, function(key, value) {
    if (typeof value === 'string' && ((key === 'data' && ['png','jpeg','webp'].includes(this?.format)) || key === 'image' || value.startsWith('data:image/'))) {
      const payload = value.replace(/^data:image\/[^;]+;base64,/, '');
      const bytes = Buffer.from(payload, 'base64');
      const file = `image-${++image}.bin`;
      fs.writeFileSync(`${run}/${file}`, bytes);
      return { file, sha256: hash(bytes), bytes: bytes.length };
    }
    return value;
  });
  for (const secret of secrets) text = text.split(secret).join('<credential redacted>');
  return text;
}
const log = (event, data={}) => fs.appendFileSync(`${run}/events.jsonl`, safe({event, time:Date.now(), ...data})+'\n');
const files = ['daemon/dist/main.mjs','packages/desktop/dist/mastra.mjs','packages/desktop/dist/index.mjs','packages/transport/dist/index.mjs','packages/protocol-types/src/index.ts','docs/proofs/model-desktop-task-2026-09-06/fixture.sh','docs/proofs/model-desktop-task-2026-09-06/verify.mjs','docs/proofs/field-mapping-form-completion/model-driver.mjs'];
const metadata = {model:'google/gemini-2.5-flash', temperature:0, maxSteps:24, modelDeadlineMs:180000, task, instructionsSha256:hash(INSTRUCTIONS), artifactHashes:Object.fromEntries(files.map(p=>[p,hash(fs.readFileSync(new URL('../../../'+p,import.meta.url)))]))};
fs.writeFileSync(`${run}/metadata.json`, JSON.stringify(metadata,null,2)+'\n');
let desk, timer; let calls=0;
const controller = new AbortController();
try {
  if (!process.env.GOOGLE_API_KEY) throw new Error('Missing GOOGLE_API_KEY');
  let address;
  for(let i=0;i<80;i++) {
    const match = /websocket listening on (127\.0\.0\.1:\d+)/.exec(fs.existsSync(`${run}/daemon.log`) ? fs.readFileSync(`${run}/daemon.log`,'utf8') : '');
    if(match) {address=`ws://${match[1]}`;break;} await sleep(200);
  }
  if(!address) throw new Error('daemon readiness timeout');
  desk = new MastraCC({url:address});
  const tools=Object.fromEntries(Object.entries(desk.getTools({beforeDispatch:()=>controller.signal.throwIfAborted()})).map(([name,tool])=>[name,{...tool,execute:async(...args)=>{
    controller.signal.throwIfAborted(); const call=++calls; log('call',{call,name,arguments:args[0]});
    try {const result=await tool.execute(...args);log('result',{call,name,result});return result;}
    catch(error){log('tool-error',{call,name,error:String(error)});throw error;}
  }}]));
  const agent=new Agent({id:'field-mapping-proof',name:'field-mapping-proof',instructions:INSTRUCTIONS,model:metadata.model,tools});
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{const e=new Error('180-second model deadline');controller.abort(e);reject(e);},180000);});
  const answer=await Promise.race([agent.generate(task,{maxSteps:24,abortSignal:controller.signal,modelSettings:{temperature:0},onStepFinish:()=>log('step-finished')}),deadline]);
  controller.signal.throwIfAborted();log('model-finished',{text:String(answer.text??''),finishReason:answer.finishReason});
} catch(error) {log('failure',{error:String(error)});process.exitCode=1;}
finally {clearTimeout(timer);controller.abort();await desk?.close();}

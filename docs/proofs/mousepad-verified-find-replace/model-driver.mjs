// Copied into the isolated consumer; all package imports resolve there.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { MastraCC, INSTRUCTIONS } from '@mastra-cc/desktop/mastra';
import { Agent } from '@mastra/core/agent';
const run = process.argv[2];
const hash = b => createHash('sha256').update(b).digest('hex');
const consumer = fs.realpathSync(fileURLToPath(new URL('.', import.meta.url)));
const imports = Object.fromEntries(['@mastra-cc/desktop', '@mastra-cc/desktop/mastra', '@mastra/core/agent', '@mastra-cc/transport', '@mastra-cc/protocol-types'].map(name => [name, fs.realpathSync(fileURLToPath(import.meta.resolve(name)))]));
for (const p of Object.values(imports)) assert.ok(p.startsWith(consumer + '/'), 'workspace import');
const secrets = Object.entries(process.env).filter(([k,v]) => /API_KEY|TOKEN|SECRET|PASSWORD/i.test(k) && v.length > 12).map(([,v]) => v);
let image = 0, sequence = 0, calls = 0, active = 0, timer;
function log(event, data = {}) {
  let text = JSON.stringify({event, sequence: ++sequence, time: Date.now(), ...data}, function(k,v) {
    if (typeof v === 'string' && k === 'data' && ['png','jpeg','webp'].includes(this?.format)) {
      const bytes = Buffer.from(v, 'base64'), file = `capture-${++image}.${this.format}`;
      fs.writeFileSync(`${run}/${file}`, bytes); return {file, sha256:hash(bytes)};
    }
    return v;
  });
  for (const secret of secrets) text = text.split(secret).join('<credential redacted>');
  fs.appendFileSync(`${run}/events.jsonl`, text + '\n');
}
let desk;
const controller = new AbortController();
try {
  const {model} = JSON.parse(fs.readFileSync(`${run}/../declaration.json`, 'utf8'));
  assert.ok(['google/gemini-2.5-flash','anthropic/claude-sonnet-4-5-20250929'].includes(model), 'unapproved model');
  assert.ok(process.env[model.startsWith('anthropic/') ? 'ANTHROPIC_API_KEY' : 'GOOGLE_API_KEY'], 'provider credential missing');
  let address;
  for(let i=0;i<80;i++) {
    const match = /websocket listening on (127\.0\.0\.1:\d+)/.exec(fs.existsSync(`${run}/daemon.log`) ? fs.readFileSync(`${run}/daemon.log`,'utf8') : '');
    if(match) {address=`ws://${match[1]}`;break;} await sleep(200);
  }
  assert.ok(address, 'daemon readiness timeout');
  desk = new MastraCC({url:address});
  await desk.client();
  const setup = desk.getTools();
  let ready = false;
  for (let i=0;i<80;i++) {
    const result = await setup.queryElements.execute({application:'mousepad', role:'application', limit:2});
    log('setup-readiness',{result});
    if(result.elements?.length === 1) {ready=true;break;} await sleep(200);
  }
  assert.ok(ready, 'Mousepad readiness timeout');
  const metadata = {imports, consumer, handshake:'accepted', instructionsSha256:hash(INSTRUCTIONS), model, temperature:0, maxSteps:24, modelDeadlineMs:180000};
  fs.writeFileSync(`${run}/metadata.json`, JSON.stringify(metadata,null,2)+'\n');
  const tools = Object.fromEntries(Object.entries(desk.getTools({beforeDispatch:()=>controller.signal.throwIfAborted()})).map(([name,tool])=>[name,{...tool,execute:async(...args)=>{
    controller.signal.throwIfAborted(); const call=++calls; active++; log('call',{call,name,arguments:args[0]});
    try {const result=await tool.execute(...args);log('result',{call,name,result});return result;}
    catch(error){log('tool-error',{call,name,error:String(error)});throw error;}
    finally {active--;}
  }}]));
  const agent = new Agent({id:'mousepad-completion-proof',name:'mousepad-completion-proof',instructions:INSTRUCTIONS,model:metadata.model,tools});
  log('model-started');
  timer=setTimeout(()=>{log('deadline');controller.abort(new Error('180-second model deadline'));},180000);
  // Await actual settlement. The outer owned process group is the hard deadline.
  const answer=await agent.generate(fs.readFileSync(`${run}/task.txt`,'utf8'),{maxSteps:24,abortSignal:controller.signal,modelSettings:{temperature:0},onStepFinish:step=>log('step-finished',{text:step.text,finishReason:step.finishReason})});
  controller.signal.throwIfAborted(); assert.equal(active,0,'unfinished tools');
  log('model-finished',{text:String(answer.text??''),finishReason:answer.finishReason});
} catch(error) {log('failure',{error:String(error)});process.exitCode=1;}
finally {clearTimeout(timer);controller.abort();await desk?.close();log('closed',{active});}

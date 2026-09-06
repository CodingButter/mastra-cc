// This file is copied into the installed consumer before execution.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { MastraCC, INSTRUCTIONS } from '@mastra-cc/desktop/mastra';
import { Agent } from '@mastra/core/agent';
const [run, stage] = process.argv.slice(2);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const imports = Object.fromEntries(['@mastra-cc/desktop', '@mastra-cc/desktop/mastra', '@mastra/core/agent', '@mastra-cc/protocol-types', '@mastra-cc/transport'].map(name => [name, fs.realpathSync(fileURLToPath(import.meta.resolve(name)))]));
const consumer = fs.realpathSync(fileURLToPath(new URL('.', import.meta.url)));
for (const resolved of Object.values(imports)) assert.ok(resolved.startsWith(consumer), `outside consumer: ${resolved}`);
assert.equal(typeof Agent, 'function');
let address;
for (let n = 0; n < 80; n++) {
  const match = /websocket listening on (127\.0\.0\.1:\d+)/.exec(fs.readFileSync(`${run}/daemon.log`, 'utf8'));
  if (match) { address = `ws://${match[1]}`; break; }
  await sleep(200);
}
assert.ok(address, 'daemon ready');
const desk = new MastraCC({ url: address });
const tools = desk.getTools();
let call = 0;
const events = [];
async function invoke(name, arguments_) {
  const id = ++call;
  events.push({ type: 'call', call: id, name, arguments: arguments_, time: Date.now() });
  const result = await tools[name].execute(arguments_);
  if (result.image?.data) {
    const bytes = Buffer.from(result.image.data, 'base64');
    const file = `${stage}-public-${id}.${result.image.format}`;
    fs.writeFileSync(`${run}/${file}`, bytes);
    events.push({ type: 'result', call: id, result: { ...result, image: { ...result.image, data: { file, sha256: sha256(bytes) } } }, time: Date.now() });
  } else events.push({ type: 'result', call: id, result, time: Date.now() });
  return result;
}
try {
  await desk.client(); // Transport enforces the actual schema handshake, not a manifest comparison.
  console.log('DAEMON_SCHEMA_GREEN');
  fs.writeFileSync(`${run}/${stage}-installed.json`, JSON.stringify({ imports, instructionsSha256: sha256(INSTRUCTIONS), handshake: 'accepted' }, null, 2));
  console.log('INSTALLED_CONSUMER_GREEN');
  const apps = await invoke('queryElements', { application: 'mousepad', role: 'application', limit: 2 });
  assert.equal(apps.elements?.length, 1, 'one public Mousepad');
  await invoke('listApplications', {});
  if (tools.discoverElements) await invoke('discoverElements', { application: 'mousepad' });
  const all = await invoke('queryElements', { application: 'mousepad', limit: 200 });
  const observed = new Map((all.elements ?? []).map(element => [element.id, element]));
  for (const role of ['text', 'textbox', 'generic', 'window', 'dialog']) {
    const result = await invoke('queryElements', { application: 'mousepad', role, limit: 100 });
    for (const element of result.elements ?? []) observed.set(element.id, element);
  }
  for (const element of observed.values()) {
    if (element.role === 'text') {
      await invoke('readElementContent', { id: element.id, offset: 0, limit: 4096 });
      await invoke('captureElement', { id: element.id });
    }
    if (element.role === 'window') await invoke('captureElement', { id: element.id });
  }
} finally {
  fs.writeFileSync(`${run}/${stage}-public.json`, JSON.stringify(events, null, 2) + '\n');
  await desk.close();
}

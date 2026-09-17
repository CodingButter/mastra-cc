// CC-08 on a real bus: a watch on one container while the element it covers
// is moved out, moved back, moved to another window, and that window is
// destroyed. The daemon's rule is that only PROVEN membership emits and that
// membership is re-read per signal rather than cached; this records whether a
// live GTK application agrees. No model, no network.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {MastraCC} from '@mastra-cc/desktop/mastra';
const run = process.argv[2];
const log = (event, data = {}) => fs.appendFileSync(`${run}/trace.jsonl`, JSON.stringify({event, monotonicMs: performance.now(), ...data}) + '\n');
globalThis.fetch = async () => { throw Error('model/network calls forbidden'); };
let desk, detach;
const command = (line) => { fs.writeFileSync(`${run}/commands`, line + '\n'); log('command', {line}); };
const phases = [];
try {
  let address;
  for (let i = 0; i < 80; i++) { const m = /websocket listening on (127\.0\.0\.1:\d+)/.exec(fs.existsSync(`${run}/daemon.log`) ? fs.readFileSync(`${run}/daemon.log`, 'utf8') : ''); if (m) { address = `ws://${m[1]}`; break; } await sleep(250); }
  assert.ok(address, 'daemon ready');
  desk = new MastraCC({url: address}); const client = await desk.client(), tools = desk.getTools();
  async function call(name, args) { const r = await tools[name].execute(args); log('tool', {name, args, refusal: r.refusal}); return r; }
  async function must(name, args) { const r = await call(name, args); assert.ok(!r.refusal, `${name}: ${r.refusal}`); return r; }
  let left, doc, elements;
  for (let i = 0; i < 60; i++) {
    const apps = await call('listApplications', {});
    if (apps.applications?.some((a) => a.name === 'reparent-fixture' && a.running === 'answering')) {
      elements = (await must('queryElements', {application: 'reparent-fixture', limit: 500})).elements;
      left = elements.find((e) => e.name === 'Left'); doc = elements.find((e) => e.role === 'text' && e.name === 'doc');
      if (left && doc) break;
    }
    await sleep(250);
  }
  assert.ok(left && doc, `fixture elements found (left=${left?.id}, doc=${doc?.id})`);
  fs.writeFileSync(`${run}/inventory.json`, JSON.stringify(elements.map((e) => ({id: e.id, role: e.role, name: e.name})), null, 2));
  const received = [];
  detach = client.onChangeEvent((e) => { received.push(e); log('receipt', {subscriptionId: e.subscriptionId, id: e.id, kind: e.kind, attribution: e.attribution}); });
  const onLeft = (await must('subscribeElement', {id: left.id, priority: 'medium'})).subscription?.subscriptionId;
  assert.ok(onLeft, 'subscribed to the Left frame');
  const countFor = (sub, from) => received.slice(from).filter((e) => e.subscriptionId === sub && e.kind === 'changed').length;
  async function phase(name, expectInside) {
    const from = received.length;
    await must('setElementText', {id: doc.id, text: `${name} ${Date.now()}`});
    await sleep(700);
    const changed = countFor(onLeft, from);
    const verdict = expectInside ? changed >= 1 : changed === 0;
    phases.push({phase: name, expected: expectInside ? 'inside: emits' : 'outside: silent', changedOnLeftWatch: changed, ok: verdict});
    log('phase', phases[phases.length - 1]);
    assert.ok(verdict, `${name}: expected ${expectInside ? '>=1' : '0'} changes on the Left watch, saw ${changed}`);
  }
  const ack = async (want) => { for (let i = 0; i < 40; i++) { if (fs.readFileSync(`${run}/app.log`, 'utf8').includes(want)) return; await sleep(100); } throw Error(`fixture never said ${JSON.stringify(want)}`); };
  await phase('in-left', true);
  command('right'); await ack('moved right'); await sleep(300);
  await phase('moved-right', false);
  command('left'); await ack('moved left'); await sleep(300);
  await phase('back-in-left', true);
  // A second watch directly on the element, for the root-removal half.
  const onDoc = (await must('subscribeElement', {id: doc.id, priority: 'medium'})).subscription?.subscriptionId;
  assert.ok(onDoc);
  command('annex'); await ack('moved annex'); await sleep(300);
  await phase('moved-to-annex', false);
  const beforeDestroy = received.length;
  command('destroy-annex'); await ack('destroyed annex'); await sleep(1500);
  const afterDestroy = received.slice(beforeDestroy).filter((e) => e.subscriptionId === onDoc).map((e) => e.kind);
  const stillThere = (await call('queryElements', {application: 'reparent-fixture', role: 'text', limit: 50})).elements?.some((e) => e.name === 'doc') ?? false;
  const health = await call('unsubscribeElement', {subscriptionId: onDoc});
  const rootRemoval = {phase: 'destroy-annex', expected: 'watchEnded once; element gone; unsubscribe reports it had already ended', docWatchKindsAfterDestroy: afterDestroy, docStillQueryable: stillThere, unsubscribeEnded: health.ended, unsubscribeRefusal: health.refusal ?? null};
  rootRemoval.ok = afterDestroy.filter((k) => k === 'watchEnded').length === 1 && afterDestroy[afterDestroy.length - 1] === 'watchEnded' && !stillThere && health.ended === false;
  phases.push(rootRemoval);
  log('phase', rootRemoval);
  assert.ok(rootRemoval.ok, `root removal: ${JSON.stringify(rootRemoval)}`);
  await must('unsubscribeElement', {subscriptionId: onLeft});
  fs.writeFileSync(`${run}/result.json`, JSON.stringify({scope: 'one GTK3 fixture on a private bus; membership re-read per signal; not a claim about every toolkit', phases, receipts: received.length}, null, 2));
} finally { try { command('quit'); } catch {} detach?.(); await desk?.close(); }

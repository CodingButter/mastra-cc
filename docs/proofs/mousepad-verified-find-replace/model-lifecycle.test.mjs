import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { runTrials } from './model-supervisor.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trial-proof-'));
  const dirs = ['t1', 't2', 't3'].map(id => {
    const dir = path.join(root, id); fs.mkdirSync(dir);
    fs.writeFileSync(`${dir}/events.jsonl`, '{"event":"model-started"}\n');
    fs.writeFileSync(`${dir}/expected.txt`, 'saved'); fs.writeFileSync(`${dir}/document.txt`, 'saved');
    return dir;
  });
  return { root, dirs };
}
const settings = code => ({ command: process.execPath, args: ['-e', code], timeoutMs: 3000, graceMs: 40, intervalMs: 10, inspect: () => null });

test('monitor failure and log-open failure persist independently; next trial runs', async () => {
  const { root, dirs } = fixture();
  try {
    fs.mkdirSync(`${dirs[1]}/session.log`);
    const results = await runTrials(dirs, dir => ({ ...settings(dir === dirs[0] ? 'setInterval(()=>{},1000)' : ''), inspect: () => { if (dir === dirs[0]) throw Object.assign(new Error('portal'), { code: 'ECONNABORTED' }); return null; } }));
    assert.equal(results[0].reason, 'artifact-monitor-error'); assert.equal(results[0].detail, 'ECONNABORTED');
    assert.equal(results[1].reason, 'session-setup-error'); assert.equal(results[1].detail, 'EISDIR');
    assert.equal(results[2].code, 0); assert.equal(results[2].category, 'verification-pending');
    for (const [i, dir] of dirs.entries()) assert.deepEqual(JSON.parse(fs.readFileSync(`${dir}/attempt.json`)), results[i]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('malformed events are retained as invalid and do not prevent later trials', async () => {
  const { root, dirs } = fixture();
  try {
    fs.writeFileSync(`${dirs[0]}/events.jsonl`, 'null\n');
    const results = await runTrials(dirs, () => settings(''));
    assert.equal(results[0].reason, 'evidence-read-error');
    assert.equal(results[1].category, 'verification-pending');
    for (const [i, dir] of dirs.entries()) assert.deepEqual(JSON.parse(fs.readFileSync(`${dir}/attempt.json`)), results[i]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unwritable attempt paths return infrastructure evidence and skip all remaining trials', async () => {
  const { root, dirs } = fixture();
  try {
    fs.mkdirSync(`${dirs[0]}/attempt.json`); fs.mkdirSync(`${dirs[1]}/attempt.json`);
    const results = await runTrials(dirs, () => settings(''));
    assert.equal(results[0].reason, 'evidence-write-error'); assert.equal(results[0].persistenceFailed, true);
    assert.equal(results[1].reason, 'evidence-write-error'); assert.equal(results[1].notStarted, true);
    assert.equal(results[2].reason, 'batch-aborted');
    assert.deepEqual(JSON.parse(fs.readFileSync(`${dirs[2]}/attempt.json`)), results[2]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('external interruption during cleanup persists current and aborted trial evidence', () => {
  const { root, dirs } = fixture();
  try {
    const module = new URL('./model-supervisor.mjs', import.meta.url).href;
    // Hook the real /proc read to signal while cleanup verification owns the lifecycle.
    const code = `import fs from 'node:fs';import {runTrials} from ${JSON.stringify(module)};const read=fs.readdirSync;let once=false;fs.readdirSync=function(p,...args){if(p==='/proc'&&!once){once=true;process.kill(process.pid,'SIGTERM');return ['999999999'];}return read.call(this,p,...args)};const readFile=fs.readFileSync;fs.readFileSync=function(p,...args){if(p==='/proc/999999999/stat')return '999999999 (test) S 1 '+readFile('${root}/pid','utf8')+' 0';return readFile.call(this,p,...args)};const dirs=${JSON.stringify(dirs)};const result=await runTrials(dirs,()=>({command:process.execPath,args:['-e',"require('node:fs').writeFileSync('${root}/pid',String(process.pid))"],inspect:()=>null,timeoutMs:3000}));console.log(JSON.stringify(result));`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 0, child.stderr);
    const outcomes = JSON.parse(child.stdout);
    assert.equal(outcomes[0].reason, 'interrupted');
    assert.equal(outcomes[0].cleanupVerified, true);
    assert.equal(outcomes[1].reason, 'batch-aborted'); assert.equal(outcomes[2].reason, 'batch-aborted');
    for (const [i, dir] of dirs.entries()) assert.deepEqual(JSON.parse(fs.readFileSync(`${dir}/attempt.json`)), outcomes[i]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

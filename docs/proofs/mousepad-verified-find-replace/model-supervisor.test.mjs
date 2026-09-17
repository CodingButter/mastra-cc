import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { artifactBytes, activeGroupMembers, supervise } from './model-supervisor.mjs';

const run = (code, options = {}) => supervise({ command: process.execPath, args: ['-e', code], stdio: 'ignore', inspect: () => null, timeoutMs: 3000, graceMs: 40, intervalMs: 10, ...options });

test('a failed session is recorded and the next session can run', async () => {
  const failure = await run('process.exit(7)');
  assert.equal(failure.code, 7); assert.equal(failure.reason, null); assert.equal(failure.cleanupVerified, true);
  const success = await run('process.exit(0)');
  assert.equal(success.code, 0); assert.equal(success.cleanupVerified, true);
});

test('spawn failure resolves with explicit evidence', async () => {
  const result = await run('', { command: '/nonexistent-mousepad-proof-executable' });
  assert.equal(result.reason, 'spawn-error'); assert.equal(result.detail, 'ENOENT'); assert.equal(result.cleanupVerified, true);
});

test('monitor ECONNABORTED terminates a stubborn owned child and grandchild', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-proof-'));
  try {
    const ready = path.join(dir, 'ready');
    const code = `const fs=require('node:fs'); const {spawn}=require('node:child_process'); process.on('SIGTERM',()=>{}); const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000);console.log('ready')"],{stdio:['ignore','pipe','ignore']});child.stdout.once('data',()=>fs.writeFileSync(${JSON.stringify(ready)},JSON.stringify({parent:process.pid,child:child.pid})));setInterval(()=>{},1000);`;
    const result = await run(code, { inspect: () => { if (fs.existsSync(ready)) throw Object.assign(new Error('disconnected portal'), { code: 'ECONNABORTED' }); } });
    assert.equal(result.reason, 'artifact-monitor-error'); assert.equal(result.detail, 'ECONNABORTED');
    assert.equal(result.signal, 'SIGKILL'); assert.equal(result.cleanupVerified, true);
    const pids = JSON.parse(fs.readFileSync(ready));
    assert.deepEqual(activeGroupMembers(pids.parent), []);
    for (const pid of Object.values(pids)) {
      try { const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); assert.match(stat.slice(stat.lastIndexOf(')') + 2), /^[ZX] /); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('timeout is bounded and produces teardown evidence', async () => {
  const result = await run('setInterval(()=>{},1000)', { timeoutMs: 100 });
  assert.equal(result.reason, 'session-timeout'); assert.equal(result.cleanupVerified, true);
});

test('resource limit becomes an explicit refusal', async () => {
  const result = await run('setInterval(()=>{},1000)', { inspect: () => 'trial-size-limit' });
  assert.equal(result.reason, 'trial-size-limit'); assert.equal(result.cleanupVerified, true);
});

test('artifact scanning counts regular files but not symlinks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-proof-'));
  try { fs.writeFileSync(path.join(dir, 'file'), '12345'); fs.symlinkSync(dir, path.join(dir, 'loop')); assert.equal(artifactBytes(dir), 5); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('portal mount is not traversed; unreadable same-device directory fails closed', () => {
  const stat = (dev, file = false) => ({ dev, size: 7, isDirectory: () => !file, isFile: () => file, isSymbolicLink: () => false });
  const io = { lstatSync: p => stat(p === '/root/portal' ? 2 : 1, p === '/root/file'), readdirSync: p => { assert.equal(p, '/root'); return ['portal', 'file']; } };
  assert.equal(artifactBytes('/root', io), 7);
  io.lstatSync = () => stat(1);
  io.readdirSync = () => { throw Object.assign(new Error('portal disconnected'), { code: 'ECONNABORTED' }); };
  assert.throws(() => artifactBytes('/root', io), { code: 'ECONNABORTED' });
});

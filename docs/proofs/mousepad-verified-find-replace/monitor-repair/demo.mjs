import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { runTrials } from '../model-supervisor.mjs';
// Reproduce the old unguarded callback without launching a desktop or orphaning a worker.
const baseline = spawnSync(process.execPath, ['-e', `const bytes=()=>{throw Object.assign(new Error('disconnected runtime portal'),{code:'ECONNABORTED'})};setInterval(()=>{if(bytes('/fixture')>256*1024*1024)process.exit(2)},1);`], { encoding: 'utf8', timeout: 5000 });
assert.equal(baseline.status, 1); assert.match(baseline.stderr, /ECONNABORTED/);
console.log('PROOF: RED — old unguarded callback crashes (isolated reproduction, not a historical checkout run)');
// Exercise the actual batch lifecycle entry point with harmless subprocesses.
const root = fs.mkdtempSync('/tmp/mousepad-monitor-demo.');
const dirs = ['failed-monitor', 'independent-session'].map(name => {
  const dir = `${root}/${name}`; fs.mkdirSync(dir);
  fs.writeFileSync(`${dir}/events.jsonl`, '{"event":"model-started"}\n');
  fs.writeFileSync(`${dir}/document.txt`, 'fixture'); fs.writeFileSync(`${dir}/expected.txt`, 'fixture');
  return dir;
});
const attempts = await runTrials(dirs, dir => ({ command: process.execPath, args: ['-e', dir === dirs[0] ? 'setInterval(()=>{},1000)' : 'process.exit(0)'], graceMs: 50, intervalMs: 20, timeoutMs: 3000, inspect: () => { if (dir === dirs[0]) throw Object.assign(new Error('disconnected portal'), { code: 'ECONNABORTED' }); return null; } }));
assert.equal(attempts[0].reason, 'artifact-monitor-error'); assert.equal(attempts[0].detail, 'ECONNABORTED');
assert.equal(attempts[1].code, 0); assert.equal(attempts[1].category, 'verification-pending');
for (const [index, attempt] of attempts.entries()) {
  assert.equal(attempt.cleanupVerified, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${dirs[index]}/attempt.json`)), attempt);
  console.log(JSON.stringify({ session: index + 1, reason: attempt.reason, code: attempt.code, cleanupVerified: attempt.cleanupVerified, persisted: true }));
}
console.log(`Retained lifecycle evidence: ${root}`);
console.log('PROOF: GREEN — monitor error persisted, owned group stopped, independent session ran; no model acceptance claim');

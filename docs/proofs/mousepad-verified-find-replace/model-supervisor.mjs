import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Runtime portals can mount unrelated filesystems beneath XDG_RUNTIME_DIR.
// Count regular artifacts only, without following links or crossing devices.
export function artifactBytes(root, io = fs) {
  const device = io.lstatSync(root).dev;
  function visit(file) {
    let stat;
    try { stat = io.lstatSync(file); } catch (error) {
      if (error.code === 'ENOENT') return 0;
      throw error;
    }
    if (stat.isSymbolicLink() || stat.dev !== device) return 0;
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    return io.readdirSync(file).reduce((sum, name) => sum + visit(path.join(file, name)), 0);
  }
  return visit(root);
}

export function activeGroupMembers(group) {
  return fs.readdirSync('/proc').filter(name => /^\d+$/.test(name)).flatMap(name => {
    let text;
    try { text = fs.readFileSync(`/proc/${name}/stat`, 'utf8'); } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') return [];
      throw error;
    }
    const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
    if (!text.includes(')') || !/^[A-Za-z]$/.test(fields[0]) || !/^\d+$/.test(fields[2])) throw new Error('malformed process stat');
    return Number(fields[2]) === group && !['Z', 'X'].includes(fields[0]) ? [Number(name)] : [];
  });
}

export async function supervise({ command, args, cwd, stdio, inspect, timeoutMs = 240000, graceMs = 15000, intervalMs = 1000 }) {
  const child = spawn(command, args, { cwd, stdio, detached: true });
  let reason = null, detail = null, hard, finalWait, finish;
  function signal(value) {
    if (!child.pid) return;
    try { process.kill(-child.pid, value); } catch (error) {
      if (error.code !== 'ESRCH') { reason ??= 'cleanup-error'; detail ??= error.code ?? error.message; }
    }
  }
  function stop(why, error) {
    if (reason) return;
    reason = why; detail = error?.code ?? error?.message ?? null;
    signal('SIGTERM');
    hard = setTimeout(() => {
      signal('SIGKILL');
      finalWait = setTimeout(() => finish({ code: null, signal: null }), 2000);
    }, graceMs);
  }
  const interrupt = () => stop('interrupted');
  process.on('SIGTERM', interrupt); process.on('SIGINT', interrupt);
  const deadline = setTimeout(() => stop('session-timeout'), timeoutMs);
  const monitor = setInterval(() => {
    try { const violation = inspect(); if (violation) stop(violation); }
    catch (error) { stop('artifact-monitor-error', error); }
  }, intervalMs);
  let result;
  try {
    result = await new Promise(resolve => {
      finish = resolve;
      child.once('error', error => { reason ??= 'spawn-error'; detail ??= error.code ?? error.message; resolve({ code: null, signal: null }); });
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
  } finally {
    clearTimeout(deadline); clearInterval(monitor); clearTimeout(hard); clearTimeout(finalWait);
    // A reaped leader cannot clean up remaining group members: kill them now.
    signal('SIGKILL');
  }
  let cleanupVerified = !child.pid;
  try {
    for (let i = 0; child.pid && i < 100; i++) {
      if (activeGroupMembers(child.pid).length === 0) { cleanupVerified = true; break; }
      await delay(20);
    }
  } catch (error) { detail ??= error.code ?? error.message; }
  if (!cleanupVerified) { reason ??= 'cleanup-unverified'; child.unref(); }
  clearTimeout(hard); clearTimeout(finalWait);
  process.off('SIGTERM', interrupt); process.off('SIGINT', interrupt);
  return { ...result, reason, detail, cleanupVerified };
}

function persistAttempt(dir, attempt) {
  try { fs.writeFileSync(`${dir}/attempt.json`, JSON.stringify(attempt, null, 2) + '\n'); return attempt; }
  catch (error) {
    const failure = { ...attempt, priorReason: attempt.reason, reason: 'evidence-write-error', detail: error.code ?? error.message, category: 'harness/resource-invalid', persistenceFailed: true };
    console.error(JSON.stringify({ directory: dir, attempt: failure }));
    return failure;
  }
}

export async function runTrials(dirs, optionsFor) {
  const attempts = [];
  let aborted = false;
  for (const dir of dirs) {
    let attempt;
    if (aborted) {
      attempt = { code: null, reason: 'batch-aborted', category: 'harness/resource-invalid', exactSavedBytes: false, cleanupVerified: true, notStarted: true, ended: Date.now() };
      attempt = persistAttempt(dir, attempt);
    } else attempt = await runTrial(dir, optionsFor(dir));
    attempts.push(attempt);
    if (attempt.persistenceFailed || !attempt.cleanupVerified || ['interrupted', 'batch-timeout', 'batch-size-limit'].includes(attempt.reason)) aborted = true;
  }
  return attempts;
}

export async function runTrial(dir, options) {
  let interrupted = false, log;
  const interrupt = () => { interrupted = true; };
  process.on('SIGTERM', interrupt); process.on('SIGINT', interrupt);
  let outcome = { code: null, signal: null, reason: null, detail: null, cleanupVerified: true };
  let events = [], exact = false;
  try {
    try {
      log = fs.openSync(`${dir}/session.log`, 'a');
      outcome = await supervise({ ...options, stdio: ['ignore', log, log] });
    } catch (error) { outcome.reason = 'session-setup-error'; outcome.detail = error.code ?? error.message; }
    finally {
      if (log !== undefined) {
        try { fs.closeSync(log); } catch (error) { outcome.reason ??= 'log-close-error'; outcome.detail ??= error.code ?? error.message; }
      }
    }
    try {
      events = fs.existsSync(`${dir}/events.jsonl`) ? fs.readFileSync(`${dir}/events.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
      if (events.some(event => !event || typeof event !== 'object' || typeof event.event !== 'string')) throw new Error('malformed event record');
      exact = fs.existsSync(`${dir}/document.txt`) && fs.readFileSync(`${dir}/document.txt`).equals(fs.readFileSync(`${dir}/expected.txt`));
    } catch (error) { outcome.reason ??= 'evidence-read-error'; outcome.detail ??= error.code ?? error.message; }
    if (interrupted) outcome.reason = 'interrupted';
    const category = outcome.reason ? 'harness/resource-invalid' : !events.some(e => e.event === 'model-started') ? 'setup-invalid' : outcome.code !== 0 ? 'model-failure' : !exact ? 'functional-failure' : 'verification-pending';
    const attempt = { ...outcome, category, exactSavedBytes: exact, ended: Date.now() };
    return persistAttempt(dir, attempt);
  } finally { process.off('SIGTERM', interrupt); process.off('SIGINT', interrupt); }
}

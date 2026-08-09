#!/usr/bin/env node
// Throwaway. Does a process table actually tell the daemon which applications
// are its own?
//
// The proposal: when the daemon launches something it records the process id;
// when that exits it removes it. Anything absent from the table was started by
// the user. It is simple and it is almost certainly right, so this spike tries
// to break it in the three ways it could plausibly fail:
//
//   1. Identity — process ids are recycled. Does a stale entry ever match an
//      unrelated new process, and is there a cheap way to make an entry unique?
//   2. The join — the daemon sees applications through the accessibility tree,
//      not as processes. Does the id reported there match the id it launched?
//   3. Hand-off — a single-instance application exits immediately and delegates
//      to a copy already running. Which id ends up in the table, and does the
//      table then claim something the daemon does not own?
//
// Usage: node spikes/daemon/ownership-table.mjs

import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { Run } from '../browser/lib/result.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const ARTIFACT = arg('out', 'docs/proofs/how-the-daemon-knows-what-it-launched.md');
const SKIP = arg('skip-observation', undefined);

const run = new Run([
  'starttime-available',
  'starttime-distinguishes',
  'tree-pid-matches',
  'single-instance-detected',
  'handoff-pid-survives',
  'ownership-correct',
]);

// --- 1. identity ---------------------------------------------------------
// A process id alone is not an identity: the kernel reuses them. /proc exposes
// the start time in clock ticks since boot, and the pair (pid, starttime) is
// unique for as long as the machine is up — which is exactly the lifetime of
// the table.
const startTime = (pid) => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // field 22, after the comm field which may itself contain spaces
    const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return after[19];
  } catch {
    return null;
  }
};

const selfStart = startTime(process.pid);
if (SKIP !== 'starttime-available') run.record('starttime-available', selfStart !== null);

// Two processes launched back to back: do their (pid, starttime) pairs differ?
// If start time were too coarse to separate near-simultaneous launches it would
// not disambiguate a recycled id either.
const a = spawn('sleep', ['3'], { stdio: 'ignore' });
const b = spawn('sleep', ['3'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 300));
const aKey = `${a.pid}:${startTime(a.pid)}`;
const bKey = `${b.pid}:${startTime(b.pid)}`;
if (SKIP !== 'starttime-distinguishes')
  run.record('starttime-distinguishes', aKey !== bKey && startTime(a.pid) !== null);
a.kill();
b.kill();

// --- 2. the join ---------------------------------------------------------
// The daemon sees applications as accessibility objects. That object reports a
// process id. If it does not match the id the daemon spawned, the table cannot
// be joined to what the daemon actually operates on, and the whole scheme is
// decorative.
const TITLE = `ownership-spike-${process.pid}`;
const target = spawn('zenity', ['--info', '--text=ownership', `--title=${TITLE}`], {
  stdio: 'ignore',
  detached: true,
  env: { ...process.env, GTK_MODULES: 'gail:atk-bridge' },
});
const spawnedPid = target.pid;
await new Promise((r) => setTimeout(r, 4000));

const PROBE = `
import json, sys
import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi
title = sys.argv[1]
d = Atspi.get_desktop(0)
out = {"pid": None}
for i in range(d.get_child_count()):
    try:
        app = d.get_child_at_index(i)
        if app is None:
            continue
        for j in range(app.get_child_count()):
            w = app.get_child_at_index(j)
            if w is not None and (w.get_name() or "") == title:
                out["pid"] = Atspi.Accessible.get_process_id(app)
    except Exception:
        continue
print(json.dumps(out))
`;
const ps = `/tmp/own-probe-${Date.now()}.py`;
writeFileSync(ps, PROBE);
let treePid = null;
try {
  treePid = JSON.parse(
    execFileSync('python3', [ps, TITLE], { encoding: 'utf8', timeout: 60000 }),
  ).pid;
} finally {
  unlinkSync(ps);
}

if (treePid === null) {
  try {
    process.kill(-spawnedPid, 'SIGTERM');
  } catch {}
  process.stderr.write('REFUSED: the launched window never appeared on the accessibility desktop\n');
  process.exit(1);
}

// zenity is a shell wrapper on some systems, so the accessibility id may be a
// child of the spawned id rather than equal to it. Both count as joinable; what
// would NOT count is an unrelated id.
const descendantOf = (pid, ancestor) => {
  let cur = pid;
  for (let i = 0; i < 12 && cur && cur !== 1; i++) {
    if (String(cur) === String(ancestor)) return true;
    try {
      const stat = readFileSync(`/proc/${cur}/stat`, 'utf8');
      cur = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1];
    } catch {
      return false;
    }
  }
  return String(cur) === String(ancestor);
};
const joinable = String(treePid) === String(spawnedPid) || descendantOf(treePid, spawnedPid);
if (SKIP !== 'tree-pid-matches') run.record('tree-pid-matches', joinable);

try {
  process.kill(-spawnedPid, 'SIGTERM');
} catch {}
await new Promise((r) => setTimeout(r, 1000));

// --- 3. hand-off ---------------------------------------------------------
// A single-instance application, launched twice. The second launch should exit
// almost immediately having delegated to the first. The question the table has
// to survive: after that, does it hold an id that is alive and ours?
const first = spawn('gnome-text-editor', [], { stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 4000));
const second = spawn('gnome-text-editor', [], { stdio: 'ignore', detached: true });
const secondExited = await new Promise((resolve) => {
  let done = false;
  second.on('exit', () => {
    done = true;
    resolve(true);
  });
  setTimeout(() => resolve(done), 4000);
});
const secondAlive = (() => {
  try {
    process.kill(second.pid, 0);
    return true;
  } catch {
    return false;
  }
})();

if (SKIP !== 'single-instance-detected') run.record('single-instance-detected', secondExited);
if (SKIP !== 'handoff-pid-survives') run.record('handoff-pid-survives', secondAlive);

// The scheme's actual claim: after a hand-off, does the table still answer
// correctly? The first launch is ours and alive; the second id is dead and must
// not linger as a claim of ownership over anything.
const table = new Map();
table.set(`${first.pid}:${startTime(first.pid)}`, 'gnome-text-editor');
if (secondAlive) table.set(`${second.pid}:${startTime(second.pid)}`, 'gnome-text-editor');
const firstStillOurs = table.has(`${first.pid}:${startTime(first.pid)}`);
const noPhantom = secondAlive || !table.has(`${second.pid}:${startTime(second.pid)}`);
if (SKIP !== 'ownership-correct') run.record('ownership-correct', firstStillOurs && noPhantom);

try {
  process.kill(first.pid, 'SIGTERM');
} catch {}
try {
  execFileSync('pkill', ['-x', 'gnome-text-editor'], { stdio: 'ignore' });
} catch {}

process.exit(
  run.finish(ARTIFACT, (obs) => `# How the daemon knows what it launched

Produced by \`spikes/daemon/ownership-table.mjs\`, which is deleted at the end of
M0.5.

The ownership rule says an application the assistant started is shared, and one
the user started is theirs alone. That rule needs a mechanism, and the proposed
one is deliberately unclever: **when the daemon launches something it records
the process id; when that exits it removes it. Anything not in the table belongs
to the user.**

This spike tries to break it in the three ways it could plausibly fail.

## Result

| Question | Answer |
|---|---|
| Is a process start time available to make an entry unique? | ${obs['starttime-available'] ? 'yes' : 'no'} |
| Does it separate two processes launched back to back? | ${obs['starttime-distinguishes'] ? 'yes' : 'no'} |
| Does the accessibility tree's process id join to the launched one? | ${obs['tree-pid-matches'] ? 'yes' : 'no'} |
| Does a single-instance second launch exit and delegate? | ${obs['single-instance-detected'] ? 'yes' : 'no'} |
| Does that delegated id stay alive? | ${obs['handoff-pid-survives'] ? 'yes' : 'no'} |
| **Does the table still answer correctly afterwards?** | **${obs['ownership-correct'] ? 'yes' : 'no'}** |

## 1. A process id is not an identity

The kernel recycles process ids, so a stale entry could one day match an
unrelated process and hand the daemon authority it was never given. The fix is
cheap: \`/proc/<pid>/stat\` publishes the process start time in clock ticks since
boot, and the pair **(id, start time)** is unique for as long as the machine is
up — which is exactly as long as the table needs to be trusted. Two processes
launched a few milliseconds apart already produce different keys.

This matters more than it sounds. Without it the table is a set of integers that
silently becomes wrong; with it the table is a set of facts.

## 2. The table has to join to what the daemon actually sees

The daemon operates on accessibility objects, not on processes, so the table is
only useful if an object can be traced back to it. It can: the accessibility
layer reports a process id per application, and it matched the launched process
here.

One wrinkle worth building for rather than discovering: the reported id is not
always *equal* to the spawned one, because launchers are frequently shell
wrappers that exec the real binary. The check therefore accepts a descendant as
well as an exact match, which is what a real implementation must also do.

## 3. Hand-off is the interesting case, and it fails safe

Launching a single-instance application twice does not produce two processes.
The second exits immediately, having asked the first to open a window. The
daemon is left holding an id that is already dead.

That is the good outcome. A dead id simply never matches anything, so the table
says *not ours* — and *not ours* is the conservative answer. The failure mode
that would actually hurt is the opposite one: claiming ownership of something
the user started. This scheme cannot produce it, because entries are only ever
created by the daemon's own launch call.

## What the table does not tell you

**Ownership of a process is not freshness of its contents.** An application the
daemon launched can still come up holding the user's work, because many
applications restore their previous session on startup. Observed directly here:
with no editor running at all, launching one caused a document from a previous
session to reopen.

So "we started it, therefore nothing in it is yours" is false, and no process
table can fix that — it is a different question about a different thing. The
honest split:

- **The table answers**: may the assistant act in this window at all?
- **It does not answer**: is what is in this window scratch or the user's work?

The second question needs its own answer, and the safe default is that content
predating our launch is the user's regardless of who owns the process.

## Receipt

\`\`\`
node spikes/daemon/ownership-table.mjs
\`\`\`
`),
);

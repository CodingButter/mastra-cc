# How the daemon knows what it launched

Produced by `spikes/daemon/ownership-table.mjs`, which is deleted at the end of
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
| Is a process start time available to make an entry unique? | yes |
| Does it separate two processes launched back to back? | yes |
| Does the accessibility tree's process id join to the launched one? | yes |
| Does a single-instance second launch exit and delegate? | yes |
| Does that delegated id stay alive? | no |
| **Does the table still answer correctly afterwards?** | **yes** |

## 1. A process id is not an identity

The kernel recycles process ids, so a stale entry could one day match an
unrelated process and hand the daemon authority it was never given. The fix is
cheap: `/proc/<pid>/stat` publishes the process start time in clock ticks since
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

```
node spikes/daemon/ownership-table.mjs
```

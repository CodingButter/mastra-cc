# 0029 — The daemon knows what it launched

**Status:** accepted, 2026-08-09.
**Forced by:** a near-miss during M0.5 — a write spike launched its own text editor, and
session restore pulled the user's real document into it. The design that followed was the
product owner's; it was then attacked three ways and measured in
[how the daemon knows what it launched](../proofs/how-the-daemon-knows-what-it-launched.md).

## Context

[ADR-0027](0027-the-assistant-opens-the-application-itself.md) makes the assistant open
the applications it works in, which makes ownership the boundary that matters: a process
we started is one we may act in, and one the user started is theirs.

That rule is only as good as our ability to tell the two apart, and a near-miss showed how
easily that fails. A spike launched its *own* copy of a text editor. Because the editor had
`restore-session=true`, the fresh process opened the user's document from their previous
session. Nothing was written — the spike refused for an unrelated reason — but the window
on screen was indistinguishable from the user's own work.

The first diagnosis was wrong, and the correction is the useful part. The assumption was
that the spike had attached to an already-running editor. Checked rather than argued:
`pgrep -c` returned 0, so nothing had been running. **We launched it; session restore
supplied the content.** That is a worse finding than the original claim and a more useful
one, because it breaks the comfortable equation between "our process" and "safe to act in".

## Decision

**The daemon maintains a table of processes it launched. Anything not in the table was
started by the user. Two questions are answered separately.**

1. **The table records `(pid, process start time)`**, not the pid alone. Process
   identifiers are recycled; the pair is unique for the machine's uptime.
2. **Entries are only ever created by our own launch call.** This is a structural
   guarantee, not a policy: the table cannot claim something the user started, because
   nothing else writes to it.
3. **An accessibility object joins the table through the owning process's identifier**,
   accepting descendants — launcher entries are frequently shell wrappers, so the process
   we spawned is often the parent of the one that owns the window.
4. **Two questions, and the table only answers the first.**
   - *May the assistant act in this window?* — the table answers this.
   - *Is the content in it scratch, or the user's work?* — the table does **not** answer
     this, and must not be asked to.
5. **The safe default for the second question: anything predating our launch is the
   user's, whoever owns the process.** Session restore, recovered drafts, reopened tabs —
   all of it is theirs.

## Consequences

**How it fails, and in which direction.** Single-instance applications hand off to the
already-running copy and the process we spawned exits immediately. Our table then holds a
dead identifier, and the running window is correctly classified *not ours*. We lose the
ability to act in a window we arguably opened. That is the safe direction, and it is the
direction the design fails in by construction: the table can only ever disclaim its own,
never claim the user's.

The cost is that ownership must be tracked across the daemon's own restarts, or every
window becomes unowned after a crash. Unowned is the safe state, so a restart degrades to
asking rather than to acting — acceptable, and it needs saying because "the daemon
restarted and forgot" will otherwise look like a bug.

Clause 4 is the part most likely to be eroded later. It is tempting to treat "we own the
process" as "the content is ours to overwrite", and the near-miss above is exactly what
that shortcut looks like in practice. The two questions stay separate.

## Evidence

- [how the daemon knows what it launched](../proofs/how-the-daemon-knows-what-it-launched.md)
  — six checks, all passing: start time available and distinguishing, the tree's process
  identifier matching, single-instance hand-off detected, the handed-off identifier
  correctly not surviving, and ownership correct overall.
- The three attacks that shaped it: process-identifier recycling (real, solved by the start
  time pair), the process-to-accessibility-object join (holds, accepting descendants), and
  single-instance hand-off (fails safe).
- The near-miss itself: `pgrep -c` returned 0 running instances and the editor's
  `restore-session` setting was true, establishing that our own fresh process — not an
  attached existing one — surfaced the user's document.

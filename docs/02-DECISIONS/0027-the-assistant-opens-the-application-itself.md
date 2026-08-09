# 0027 — The assistant opens the application itself

**Status:** accepted, 2026-08-09.
**Supersedes:** [ADR-0020](0020-granting-an-application-is-a-transaction-with-a-rollback.md),
entirely. That record is now marked superseded.
**Forced by:** the measurement in
[which condition makes a browser readable](../proofs/which-condition-makes-a-browser-readable.md),
which closed Q01 in [09-QUESTIONS.md](../09-QUESTIONS.md).

## Context

ADR-0020 described granting an application as a transaction: rewrite its launcher entry
to add an accessibility flag, inventory every override so nothing is lost, and roll the
edits back on revoke. It was a careful design for a genuinely nasty problem — runtime
edits to files outside the repository are facts no test in the tree can see, and the
record said so plainly.

That subsystem existed because of an unprobed belief about *when* an application becomes
readable. Q01 asked whether Chromium enables its accessibility engine when an assistive
client connects. The belief was that it might, and if it did, most of ADR-0020 would
delete itself.

The measurement went further than that. It did not merely fail to find a self-enabling
path — it established that **readability is decided once, at process start, and cannot be
changed afterwards**:

| Condition | Nodes | Web-content roles |
|---|---|---|
| Baseline, no flags | 2 | 0 |
| Assistive client attached and walking | 2 | 0 |
| `--force-renderer-accessibility` | 202 | 63 |

`org.a11y.Status.IsEnabled` stayed false before and after in every condition. Connecting a
client changes nothing. The same shape appeared in every other toolkit measured: a GTK
dialog published nothing to the accessibility bus until launched with `GTK_MODULES`, at
which point the desktop went from 18 applications to 19.

So the question ADR-0020 was answering — *how do we make an installed application
readable next time the user starts it* — turns out to have a much simpler answer than
rewriting the user's launcher, and one that requires touching nothing on their system.

A second measurement removed the remaining reason to keep any of it. Over the browser
protocol the flag makes **no difference at all**: an Electron application returned 505
accessibility nodes with the flag and 505 without, because that route reads Chromium's
internal tree rather than the one it publishes to the platform. For the largest family of
applications, the precondition this ADR governs does not exist.

## Decision

**The assistant launches the application it needs to work in, with the enabling
conditions already set on that process. It never modifies how the user's system launches
anything.**

Concretely:

1. **No launcher entries are edited.** No `.desktop` files, no shortcuts, no registry
   entries, no default-browser changes. There is therefore no override inventory and no
   rollback, because there is nothing on the user's system to undo.
2. **Enabling is per-process and launch-time**, using the mechanism the target requires:
   `--force-renderer-accessibility` for Chromium, `GTK_MODULES=gail:atk-bridge` for GTK,
   and a debugging port plus its own profile directory for the browser-protocol route.
3. **If the application is already running, we ask.** The honest sentence is *"I'll need
   to restart Discord to work in it — want me to?"* We ask it to quit politely and never
   hard-kill it. We watch for the window to actually disappear; if it is still there after
   a beat, an unreadable dialog is very likely asking a question **we caused**, and we say
   so rather than guessing.
4. **System-wide accessibility settings are never written, in any trust mode, including
   the most permissive one.** Specifically `org.gnome.desktop.a11y.applications
   screen-reader-enabled`, which starts a screen reader that begins speaking aloud, and
   `toolkit-accessibility`. Trust mode is permission to act on the user's behalf, not
   permission to reconfigure their assistive technology.
5. **The dashboard states the requirement plainly** rather than hiding it: this
   application must be opened by the assistant to be usable by the assistant, and one the
   user opens themselves stays theirs.

## Consequences

**The cost, stated first.** The user cannot hand us an application they already have open
without restarting it. That is a real friction and it lands at the worst possible moment —
when they have just asked for something. There is no version of this that avoids the
friction, because the constraint is in the toolkits, not in our design. What we can do is
be honest about it in one sentence rather than fail mysteriously.

An entire subsystem is deleted: no shortcut rewriting, no override inventory, no rollback,
no reconciliation of user edits made while a grant was active. The class of bug ADR-0020
existed to contain — runtime edits to files outside the repository — is gone because we
stopped making the edits.

**Ownership falls out for free, and it answers a question we were dreading.** If the
assistant launched a process, it is a process we can act in; if the user launched it, it
is theirs. Co-tenancy — two actors typing into the same window — stops being a hazard to
engineer around and becomes a boundary that already exists. That mechanism has its own
record: [ADR-0029](0029-the-daemon-knows-what-it-launched.md).

The dashboard's story gets simpler and more honest. Instead of "grant this application"
with hidden filesystem consequences, it is "I'll open this for you."

**Two limits worth stating.** First, closing is part of opening: an application that will
not quit, or that asks an unreadable question on the way out, is a state we caused and
must report rather than work around. Second, launching our own copy does not guarantee a
clean one — a text editor launched fresh restored the user's previous session and opened
their document. **A new process is not a new context**, and anything predating our launch
is the user's regardless of who owns the process.

## Evidence

- [which condition makes a browser readable](../proofs/which-condition-makes-a-browser-readable.md)
  — three conditions with node counts; the flag is the only one that works. This is the
  artifact the prototype specified and never produced.
- The same artifact refutes, in writing, the prototype's claim
  (`computer-controls/docs/07-open-questions.md:19-22`) that an unreadable Chrome is
  absent from the accessibility desktop. It is **present and empty** — a different problem
  with a different fix.
- [which apps the browser adapter covers](../proofs/which-apps-the-browser-adapter-covers.md)
  — 68 applications inventoried, 3 classified as Chromium without launching any of them;
  the accessibility flag made no difference over the browser protocol (505 nodes either
  way).
- The GTK measurement: a dialog launched without `GTK_MODULES` published nothing; with it,
  the accessibility desktop went from 18 applications to 19.
- The screen-reader autostart mechanism was read directly:
  `/etc/xdg/autostart/orca-autostart.desktop` starts a screen reader via an
  `AutostartCondition` on the `screen-reader-enabled` key. That is why rule 4 above is
  absolute rather than a preference.

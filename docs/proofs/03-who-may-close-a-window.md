# Who may close a window

An operator decides whether this daemon may end a running program, and the
program still gets a say. Proven on the KDE desktop in `infra/webtop`, against a
real editor with real unsaved work.

Run it: `bash infra/webtop/03-who-may-close-a-window/proof.sh`

## What the two sides are

Both sides are the same container, the same editor and the same operator
decision — a capability file that sets `restart` to `graceful`. They differ only
in which daemon reads it.

- **Without** (base `29c7afc`, schema 1.8.0) — the base daemon cannot even be
  handed the decision: it rejects the `restart` block as an unknown key and
  refuses to start. Started the only way it can be started, it has no
  `restartApplication` route at all, and the driver exits non-zero.
  Transcript: [03-who-may-close-a-window-without.txt](03-who-may-close-a-window-without.txt)
- **With** (this branch, schema 1.9.0) — three beats.
  Transcript: [03-who-may-close-a-window-with.txt](03-who-may-close-a-window-with.txt)

## The three beats on the branch

1. **Nothing configured.** The daemon is started with no capability file at all
   and asked to restart an editor it opened itself. It refuses, and the refusal
   names the setting that would change the answer: *`restart.default` is
   "refuse"*. The editor is still `answering` afterwards — checked with
   `listApplications`, not assumed.
2. **Configured `graceful`, against unsaved work.** A document is created
   through the editor's own `File > New` action and written to with
   `setElementText`, until the editor's window title says it is modified. The
   restart is then asked for, and the editor says no: the daemon reports back
   `blockedBy` the `dialog` named *Close Document — Kate*, says in plain words
   that it did not answer that dialog, and the editor is still `answering`. The
   dialog is read and left alone. Nothing escalates.
3. **The same authority, nothing to lose.** A file manager with no unsaved work
   is closed and started again under the same `graceful` level, and comes back
   readable.

The second beat is the one that matters. A restart that only ever succeeded
would prove the easy half; the half worth proving is the one where a person's
unsaved work outranks the caller.

## Why there is no model in this one

Segments 01 and 02 put a real model on the wire, because the thing being proven
was what an agent could learn from the desk. This segment proves something an
agent has no part in: whether an operator's written decision is obeyed, and
whether an application's refusal outranks the caller. A model narrating that
would add a place for the run to sound right while being wrong. The driver
speaks the wire directly and every verdict is read back from the desk.

## What the harness does and does not do

No synthetic input: no `xdotool`, no `wmctrl`, no `uinput`. The document is made
and dirtied through ordinary wire verbs — `activateElement` on an action the
menu item itself publishes, and `setElementText`. The only force in the script
is its own cleanup, which kills the editor it deliberately left holding unsaved
work so the next run starts on a clean desk.

The capability file is written by the script standing in for the operator, into
the container, and passed with `--capabilities`. No input the caller sends
reaches it.

The script also refuses to run when the container has more than one
accessibility bus launcher — a state a machine can end up in, where newly
launched applications bridge to one bus while the registry serves another and
every query comes back empty. That is said out loud rather than measured as a
failure of the code under test.

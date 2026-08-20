# 0049 — What a launched application's death is tied to

- Status: accepted
- Date: 2026-08-20
- Relates to: [0027](0027-the-assistant-opens-the-application-itself.md), [0029](0029-the-daemon-knows-what-it-launched.md), issue #14, schema version 1.5.0's segment (M2.7 segment 4)

## Context

Issue #14 witnessed real orphans: five `qt6ct` instances and two gmail-recipe
Chrome trees reparented to `systemd --user`, surviving after their daemon was
SIGTERMed. Its diagnosis blamed a forking launch wrapper — the `google-chrome`
shell script forking the real browser and exiting, removing the table entry
while the app lived on.

That premise was measured on 2026-08-20 and found false on this platform.
`google-chrome` execs in place: the pid the daemon records IS the browser
master (witnessed by parentage in the measurement transcripts), and a daemon
that receives SIGTERM reaps every recipe's whole tree — yad, qt6ct and chrome
alike. The real mechanism, reproduced live, was simpler and worse: **SIGHUP**.
A closing shell sends HUP to a backgrounded daemon; the handler list carried
only SIGINT and SIGTERM, so node's default action exited without
`terminateOwned`, and everything the table owned was orphaned. That is the
M2.5 corpse, exactly.

A second gap fell out of testing the first: the daemon bound its socket —
the thing clients actually poll for readiness — before its shutdown handlers
were installed, so a signal landing in that window also died the default
death.

## Decision

1. **A launched application's death is tied to the daemon's ORDERLY death,
   and every orderly death runs the handler.** SIGINT, SIGTERM and SIGHUP all
   route through the same shutdown: `terminateOwned` first, then the server
   closes. The handlers are installed before the socket binds, so there is no
   readable daemon whose shutdown is unwired.

2. **The never-signal-a-foreign-process guarantee is unchanged.** The fix
   adds a signal the daemon *receives*, not a target it signals.
   `terminateOwned` still SIGTERMs only what the table owns, with liveness
   and (pid, start-time) identity re-checked per entry. No process group is
   killed; no descendant search is performed. The candidate process-group
   design issue #14 sketched is not needed, because the wrapper-fork scenario
   it existed to cover was not observed on the measured platform — this
   installation's `google-chrome` on this desk. That is the scope of the
   finding, no wider; decision 4 is what happens if a platform outside it
   behaves differently.

3. **The residue is named, not promised away.** SIGKILL and an outright crash
   skip cleanup by definition — no handler runs, and nothing the daemon could
   write would change that. A launched application can outlive a daemon that
   dies disorderly. Closing that residue would require ownership recorded
   somewhere that outlives the process (a persisted table a successor daemon
   reads and reaps), which drags in the (pid, start-time) attribution work
   deferred to M2.4's per-element join. Until something needs it, the honest
   sentence is: the daemon cleans up whenever it is given any chance to.

4. **If a platform appears where a launch recipe's direct child genuinely
   forks and exits**, the fails-safe direction holds: the orphan answers
   "not ours" for acting (authority unaffected), and cleanup for that
   platform reopens this record — with a measurement, not a suspicion.

## Evidence

- Per-recipe SIGTERM measurement (`s4p3-measurement.txt`; its chrome row was
  later found vacuous — an empty before-tree — and is superseded) and the
  corrected chrome measurement (`s4p3-chrome.txt`, which replaced the vacuous
  original under the same name: parentage shown directly — the recorded pid's
  parent is the daemon and the command at that pid is the real browser
  binary — with a non-empty 12-pid before-tree and an empty after-tree, and
  an empty before-tree now exits MEASUREMENT INVALID), both under
  `.mastracode/plans/m2-7-the-daemon-is-finished.proof/segment-4/`.
- The live orphan and its closure: `shutdown-without.txt` (base: qt6ct
  reparented to init, `PROOF: RED`) and `shutdown-with.txt`
  (`PROOF: GREEN`).
- `daemon/src/__tests__/daemon-dies-clean.test.ts` kills the built daemon
  with each shutdown signal and asserts it dies by code, never by signal;
  red-proven against the base build, where only the SIGHUP case fails.

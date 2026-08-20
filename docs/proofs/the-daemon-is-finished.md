# The daemon is finished — the milestone's receipt

M2.7's claim is not "work happened"; it is that every method the frozen schema
declares is served, every effect the daemon reports was verified by reading the
world back, the tooling that scores those claims guards itself, CI witnesses a
live accessibility lane, and the deferred desktop truths — the keyboard and
Gmail's vocabulary — are measured. The falsifiable version of that claim is the
exit gate in [07-ROADMAP.md](../07-ROADMAP.md); this document is the receipt
behind it: a red/green pair per segment, with the provenance of each stated
per segment rather than claimed once for all — the pairs differ honestly in
where their red came from and what scored their green, and pretending they
share one shape would be the exact overclaim this milestone exists to kill.

## The convention

Full transcripts live beside the plan that produced them, in
`.mastracode/plans/m2-7-the-daemon-is-finished.proof/segment-N/`, on the desks
that ran them — they carry live-desk process ids and session detail that do not
belong in a committed document. What is quoted here is each transcript's
verdict line, the command, and where durability matters, a commit SHA or a CI
run id a cold reader can fetch. Effect claims against a live desktop are
scored by an independent witness (its own dbus or CDP connection, or the
window manager) — a proof that asked the daemon whether the daemon was right
would be a return code wearing a tree's clothes. Two greens are scored
differently and say so where they appear: the Wayland focus verdict is green
*because* the daemon disclosed a failure the witness confirmed, and Segment
5's green is scored by the check under test.

## Segment 1 — the wire is complete (PR #27)

Four wire methods answered with constants; no client had ever driven an effect
verb over the wire. The demo drives `setElementText` through a real client
against a live yad dialog, and an independent witness on its own bus connection
reads the written text back.

- **Red** (`without.txt`, merge-base worktree): the client dies with
  `TypeError: client.setElementText is not a function` — the binding does not
  exist at base.
- **Green** (`with.txt`): the effect lands and the witness reads the new text
  back over its own connection.
- Also in this segment: the X11/Wayland `GrabFocus` measurement
  (`focus-x11.txt`, `focus-wayland.txt`) that later decides Segment 4's shape —
  X11 restores the keyboard, Wayland claims true and moves nothing.

## Segment 2 — the tooling guards itself (PR #28)

The hazard demo proves an offline mutation entry could start a real Chrome on
the operator's signed-in Gmail profile (issue #20), then proves the defanged
catalog closes it. Provenance: a live desk (minibeast) because the hazard is
about a real browser and a real profile, red legs against the base build.
Scored under a continuous process watch, not a before/after sample — the narrow sampler produced three false greens before
the watch caught the browser mid-flight.

- **Red** (base, six consecutive attempts): 6/6 runs started a real Chrome on
  the Gmail profile path.
- **Green** (branch, six consecutive attempts): 6/6 runs spawned nothing but
  the defanged `sleep` — worst case blast radius is thirty seconds of sleep.
- The runner itself: interrupting the rewritten `mutations.mjs` mid-run
  restores the mutated file before the process dies (signal test delivered to
  the process group, proven with a marker-file handshake), and a runner that
  cannot execute vitest reports the runner as broken instead of "survived".

## Segment 3 — the live lane is witnessed (PR #31)

CI had zero live-lane steps; a suite that skips is indistinguishable from a
suite that passes. The lane boots Xvfb, a private dbus session, and a real GTK
dialog on the runner, and the job's last-line lock greps the transcript.
Provenance: the reds here are a deliberate branch commit scored by CI itself
and a shimmed lane run — not merge-base worktrees, because what this segment
ships IS the CI witness, and the honest red for a witness is the witness
going red.

- **Red** (CI): commit `6a9597e` suppressed the proof line; run `32332394990`
  failed the `live` job with "did not print PROOF: GREEN" while `ci` and
  `licences` stayed green — the lock, not the suite, went red.
- **Red** (lane): a yad shimmed to exit without drawing ends
  `PROOF: RED - a lane with no window refused twenty times and printed no lock
  line (exit 1)`.
- **Green**: run `32332179363`, ending
  `PROOF: GREEN - a real element was read and the at-spi backend conformed on a
  real accessibility bus`.

## Segment 4 — the desktop truths (PR #32)

Three measurements — two carry red/green pairs, the third (the keyboard) is a
two-desk measurement whose box in the exit gate accepts either outcome and is
failed only by an unmeasured claim. Transcripts in `.proof/segment-4/`;
environment: bigbeast (X11) and minibeast (GNOME Wayland), live desks.

**Gmail's vocabulary** (schema 1.5.0, ADR-0048) — a read-only client counts
role words through the daemon on the real signed-in inbox, printing counts and
never content:

- **Red** (base, 1.4.0): grid 0 / row 0 / gridcell 0, generic 412 —
  `PROOF: RED - the wire could not name the inbox's structure (client exit 3)`.
- **Green** (branch): grid 1 / row 100 / gridcell 137 —
  `PROOF: GREEN - the inbox answered as a grid of rows of gridcells, in
  neutral words, over the wire`.

**The keyboard** (ADR-0044 amendment) — a witness on its own bus connection
plus the window manager as the exclusivity arbiter, with a mid-flight watcher
proving the launched app genuinely took the keyboard before restoration:

- **X11 (bigbeast, script v3)**: `PROOF: GREEN - the launch left the keyboard
  where it found it, and said nothing.` (`focus-x11.txt`, the v3 run)
- **Wayland (minibeast, script v2)**: the route reports success and moves
  nothing; the witness confirms the keyboard did not return and the daemon
  discloses it — `PROOF: GREEN - the daemon did not report a clean launch.`
  (`focus-wayland.txt`) — ADR-0044 clause 4's named limitation, narrowed to
  Wayland. Stated plainly: the Wayland run predates the v3 script tightenings
  (WM arbitration, verdict judged on the printed sample); the v3 re-run is an
  open follow-up, blocked on the hardware, and it tightens the instrument
  rather than changing the measured fact — Segment 1's raw `GrabFocus`
  transcript already showed the same limitation on the same desk.

**Nothing outlives the daemon** (ADR-0049, issue #14) — the leak was an
unhandled SIGHUP, not the wrapper fork the issue guessed:

- **Red** (base): `PROOF: RED - a launched application outlived the daemon` —
  qt6ct survived, reparented to pid 1.
- **Green** (branch): `PROOF: GREEN - nothing the daemon launched outlived it`.

## Segment 5 — proven and reviewed (this PR)

The index that lists these receipts could silently omit one (issue #16 —
M2.5's review caught three unlisted artifacts and nothing went red).
Provenance: a tooling proof on the feature tree — the red is a deliberately
unlisted file, not a merge-base worktree, because at base the check does not
exist to go red.

- **Red**: an unlisted markdown artifact turns `check-docs` red naming the
  file, at the top level — `proof artifact not listed in the proofs index:
  an-unlisted-measurement.md`, exit 1 — and in a subdirectory —
  `proof artifact not listed in the proofs index:
  2026-08-20-keyboard/measurement.md`, exit 1. Both legs captured against
  the recursive check as shipped (`segment-5/proofs-index-red-green.txt`).
- **Green**: the real tree, where the index covers the directory — and this
  document is itself guarded by the check it reports on: committed unlisted,
  it would have reddened the gate that shipped it.

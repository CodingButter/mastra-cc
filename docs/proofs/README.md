# Proofs

Measurements taken from M0.5 onward, and the record of how each milestone
checked itself. No count is stated here: a count that isn't checked is a claim
without a receipt, and the coverage now has a real check instead —
`scripts/check-docs.mjs` goes red when a file in this directory is not listed
below. Each measurement
answers a question in [09-QUESTIONS.md](../09-QUESTIONS.md) that could not be
answered by argument.

## The convention

Every artifact names **the command that produced it**. Those commands reference paths
under `spikes/`, which **no longer exists** — the milestone's own rule was that findings
survive in documents and code does not, and the spikes were deleted at its close.

The references are kept deliberately. A measurement without the command that produced it
is a claim without a receipt, which is the exact failure this repository is built to
avoid. To recover a spike, take it from git history:

```
git log --oneline --diff-filter=D -- spikes/     # the commit that removed them
git show <commit>^:spikes/browser/coverage-count.mjs
```

Phase commits: `e355cfb` and `2b97903`, `94b9d6c`, `170ff05` (browser), `502c228` and
`26fff50`, `2db56d6`, `576b929` (daemon), `b826c9d` (execution model), `1e0ad3d`
(improvement measurement).

## What each one answers

| Artifact | Question |
|---|---|
| [which condition makes a browser readable](which-condition-makes-a-browser-readable.md) | Q01 — the flag is mandatory; nothing else flips it |
| [what the browser protocol gives us](what-the-browser-protocol-gives-us.md) | The browser substrate's shape, including per-session re-arming |
| [what a page-level recorder observes](what-a-page-level-recorder-observes.md) | G6 — 5 of 8 effect paths; instrument, never gate |
| [can we type without taking focus](can-we-type-without-taking-focus.md) | Whether input reaches an unfocused window |
| [can we subscribe to element changes](can-we-subscribe-to-element-changes.md) | G2 — push, at 253ms from cause to observation |
| [which apps the browser adapter covers](which-apps-the-browser-adapter-covers.md) | Q02 — classification without launching |
| [which route to the tree is cheaper](which-route-to-the-tree-is-cheaper.md) | The two routes head to head, same browser, same moment |
| [what hidden actually means](what-hidden-actually-means.md) | Seven ways to be invisible; 10/10 against 6/10 on "can a person see this" |
| [can Node read the accessibility tree](can-node-read-the-accessibility-tree.md) | Q07 — Node matches Python on read |
| [can Node act on the desktop](can-node-act-on-the-desktop.md) | Q07 — and on write |
| [can Node be told the desktop changed](can-node-be-told-the-desktop-changed.md) | Q07 — and on events |
| [is the accessibility binding thread-safe](is-the-accessibility-binding-thread-safe.md) | Q08 — deterministic abort, not silent corruption |
| [what language each backend wants](what-language-each-backend-wants.md) | Q07–Q09 — the ruling, per backend |
| [how the daemon knows what it launched](how-the-daemon-knows-what-it-launched.md) | Ownership, attacked three ways |
| [what a plan can say without a model](what-a-plan-can-say-without-a-model.md) | G4, G5 — go; and scroll is a verb, not a capability |
| [does the second run cost less](does-the-second-run-cost-less.md) | G1 — steps yes, tokens not at this sample size |
| [how this milestone checked itself](how-this-milestone-checked-itself.md) | The cold-reader test, the review, and what none of it established |
| [is concurrent accessibility safe on the Node route](is-concurrent-accessibility-safe-on-the-node-route.md) | ADR-0030 clause 3's owed measurement, paid during M1 — setup and use separated; neither aborted. Produced by `tools/proofs/concurrent-accessibility.mjs`, which still exists |
| [the live suite on real hardware](the-live-suite-on-real-hardware.md) | M2 exit gate — both live lanes green on minibeast under Wayland, machine and session recorded; includes the B1 pin failing when provoked. Produced by the untracked leg `.proof/live-suite.sh` |
| [real Gmail through the daemon](real-gmail-through-the-daemon.md) | Q03 — a surface we did not author, observe-only, zero content committed. Produced by the untracked leg `.proof/gmail.sh` |
| [M6 Gmail permission composition](m6-gmail-permission-composition.md) | M6 Stage 2 — a fresh operator home receives exactly the Gmail-only launch authority, its explicit observe join, restrictive modes, and a runnable installed daemon tree. Produced by the uncommitted leg under `.mastracode/plans/m6-stage2-gmail-permission-composition.proof/` |
| [M6 orchestrator launch seam](m6-orchestrator-launch-seam.md) | M6 Stage 3 — trusted orchestration launched non-personal `yad` through the daemon gate, while the same seam preserved the unpermitted Gmail refusal byte-for-byte and never launched Gmail or Chrome. Produced by the uncommitted leg under `.mastracode/plans/m6-stage3-orchestrator-launch-seam.proof/` |
| [an unpermitted application is invisible](an-unpermitted-application-is-invisible.md) | Deny-by-default on real hardware, both routes — absent, not filtered. Produced by the untracked leg `.proof/invisible.sh` |
| [the Qt6 accessibility knob, measured](the-qt6-accessibility-knob-measured.md) | Q05's Qt row — three states asserted; the always-on variable is the knob, the Qt5-era knob is a no-op. Produced by the untracked leg `.proof/qt6.sh` |
| [every action the desktop offers, measured](every-action-the-desktop-offers.md) | M2.6 exit gate — the verbs act and an independent witness confirms it; existence and permission are readable while content is not; and the focus guarantee's named Wayland limitation, measured rather than assumed. Produced by the untracked legs `.proof/demo.sh`, `.proof/listing.sh` and `.proof/focus.sh` |
| [the daemon is finished](the-daemon-is-finished.md) | M2.7 exit gate — a red/green pair per segment on real hardware: the wire completed, the tooling guarding itself, CI witnessing the live lane, the keyboard and Gmail's vocabulary measured, and nothing outliving the daemon. Produced by the untracked legs under `.proof/segment-1..5/` |
| [which credential the voice lane accepts](which-credential-the-voice-lane-accepts.md) | M3 exit gate — one dial on a token minted for it alone, against the real provider, and three refusals that each name which failure they were: an absent account, a rejected key, and a token seen expiring on the close. Produced by the untracked legs under `.mastracode/plans/m3-the-hub-thinks.proof/segment-4/` |
| [what the face does on a real desk](what-the-face-does-on-a-real-desk.md) | Q22 — a managed window carrying `ABOVE` holds its place, is never activated by being shown, and crosses to a second output with its placement intact; and the condition the roadmap's one-line reading omits: a full-screen window that holds focus is promoted above it, and the face returns on its own when focus moves. Produced by `tools/proofs/window-model.mjs --live`, which still exists |
| [what the installable package does](what-the-installable-package-does.md) and its [desktop screenshot](installable-package-desktop.png) | P1 — a process that knows this repository only as an installed tarball drives a real desktop across a namespace boundary, and the instructions it needs travel inside the package |
| [what the face renders](what-the-face-renders.md) and its [rendered PNG](m4-face-rendered.png) | Q22's appearance half — the built lane-to-renderer path paints the orb and current caption over a composited transparent background. Produced on the repository's two-output X11 desk by the command recorded in the receipt; machine pixels and Jamie's minibeast witness agree |

## Release-gate checks

Checks that need a live desktop cannot simply be dropped into CI — a
live-requiring step run against a machine with no accessibility bus does not
fail, it kills the runner (../05-TEST-STRATEGY.md §5). They run on a desktop
machine, on a stated cadence, and their results land in the active milestone's
progress record. The one exception is a CI job that *builds itself a bus*
first and runs a committed script on it; that is what the `live` job does
(../05-TEST-STRATEGY.md §5.1), and it does not change the cadence below.

| Check | Command | Cadence |
|---|---|---|
| Tape drift | `node daemon/dist/main.mjs --verify-tape gtk-dialog` | Before each milestone closes, on a machine with a live accessibility bus. Drift is the desktop changing, not a bug — if the corpus should follow, re-capture, record the diff, and re-run the replay tests against the new tape. Undiscovered drift is the failure. |
| Live conformance | `MASTRA_CC_LIVE=1 pnpm --filter @mastra-cc/daemon test` | Before each milestone closes. The at-spi half of it also runs in CI now, on a bus CI builds for itself — `bash infra/demo.sh`, wired as the `live` job (../05-TEST-STRATEGY.md §5.1). |
| Headless lane | `bash infra/apply.sh --headless-check` | Before each milestone closes — proves a machine can capture with no monitor attached. |

## Two rules these artifacts follow

**A spike that cannot exercise a condition writes nothing.** Every measurement above
refuses rather than emitting a partial table, and the refusal was proven by making each
spike fail on purpose. The last row is not a measurement and had no spike.
The prototype specified one of these artifacts and never produced it; a half-filled table
would have been worse than the absence, because it would have been quoted.

**A number is reported with its spread, and an effect smaller than its spread is not
claimed.** [does the second run cost less](does-the-second-run-cost-less.md) reports a
token difference and explicitly declines to claim it, because the run-to-run variation is
larger than the difference.

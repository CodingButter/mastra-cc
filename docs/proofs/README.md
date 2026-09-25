# Proofs

## Running a native proof

Every proof that loads `@mastra-cc/desktop` runs against an INSTALL of this
workspace's packages, not against its source, because the thing under test
should be the thing a consumer would get. Build that install with:

```sh
node tools/proof-consumer.mjs /tmp/proof-consumer \
  --mastra <an existing node_modules to borrow @mastra/* from>
```

It prints the `node_modules` path the runners take as their second argument.
`pnpm pack` is used rather than `npm pack` because only the former resolves
`workspace:*`; the leftover protocol specifier is pinned back to the tarball
beside it with an override, so nothing is looked up in a registry it was never
published to. Framework dependencies are borrowed from an existing install
rather than fetched, so a run that claims to make no network calls makes none.

Measurements taken from M0.5 onward, and the record of how each milestone
checked itself. No count is stated here: a count that isn't checked is a claim
without a receipt, and the coverage now has a real check instead —
`scripts/check-docs.mjs` goes red when a file in this directory is not listed
below. Each measurement
answers a question in [09-QUESTIONS.md](../09-QUESTIONS.md) that could not be
answered by argument.

[Mousepad Find/Replace baseline](mousepad-verified-find-replace/README.md) records the verified delivery base and regression gates; native task completion remains unproved.

[Remaining CC-01–CC-09 requirements](reliability-remediation/AUDIT.md) separates implemented slices from unproven system-level acceptance; [FOLLOWUPS.md](reliability-remediation/FOLLOWUPS.md) lists every open sub-requirement as human-only or autonomous. [Bounded subscription initialization](reliability-remediation/cc08/initialization/README.md) retains the callback-loss regression, overflow refusal and connection-teardown proof.

[Signal lifecycle remediation](reliability-remediation/cc03/README.md) records controlled RED/GREEN regressions, retained real-socket coverage, and signal mutation checks.

[Visible-pixel capture contract](reliability-remediation/cc01/README.md) records generated-description RED/GREEN evidence and clipped, covering-pixel fixtures without claiming live desktop validation.

[Live foreground and occlusion](reliability-remediation/cc01/live/README.md) records what preparation buys on three real GTK3 windows: a covered key that still lands, a raise through the desk's own route, a press from a stale picture refused before emission, and a later cover that only a fresh look reveals.

[Typing uncertainty remediation](reliability-remediation/cc02/README.md) records Unicode and insertion-counterexample regressions, one-emission checks and retained resource bounds.

[Bounded signal retention](reliability-remediation/cc04/README.md) records built-library RED/GREEN delivery counters, hard retention bounds and trailing invalidation; immediate watch-end cleanup remains follow-up.

[Connection-bound desktop driver](reliability-remediation/cc05/README.md) records real Unix/WebSocket peer exclusion against a scripted effect sink; human takeover and task-level serialization remain follow-up.

[One task at a time on a shared connection](reliability-remediation/cc05/tasks/README.md) shows two agent loops on one connection interleaving their edits with every call valid and nothing refused, and the same two goals each holding the desk for their whole run once they ask for it.

[A reply that never comes](reliability-remediation/cc02/unanswered/README.md) shows a request on a healthy socket waiting forever, and the same request under an opt-in budget reporting its outcome as unknown rather than failed so the caller does not resend an effect that may have landed.

[Degraded ancestry, induced live](reliability-remediation/cc08/degraded-live/README.md) detaches a widget from its parent while keeping it alive, so a real change arrives from an element whose ancestry cannot be read, and records that the watch answers with a nudge at its root rather than silence or a false claim about where the change happened.
[Capture under display scaling](reliability-remediation/cc07/scaling/README.md) compares two native runs of one fixture: unscaled, every pixel returned is the element; at double scale, half the picture is window background, because the accessibility rectangle is in logical units while the grab is in device pixels.

[Unknown event origin](reliability-remediation/cc06/README.md) records built-server RED/GREEN attribution and default-wake counters across three peers and two independent backends; raw pointers remain available to active consumers.

[Partial capture safety](reliability-remediation/cc07/README.md) records real native pixel acquisition with scripted accessibility geometry: complete images remain available, four edge-clipped images are refused until crop provenance exists.

[Capture crop provenance](reliability-remediation/cc07/provenance/README.md) supersedes that refusal (ADR-0105, schema 1.25.0): the same real-pixel demo now answers four edge-clipped pictures with exact element-fraction crops, maps their centres through `locateInElement`, and shows the adapter hands the model the picture and its crop together; an empty intersection is still refused.

[Capture freshness](reliability-remediation/cc07/freshness/README.md) closes the stale-picture boundary (ADR-0107, schema 1.26.0): `clickElement` takes the picture's `capturedAt`, and the real-pixel demo shows a press naming a picture of a since-moved element, or a picture since superseded, is refused with nothing sent, while the latest picture and an unclaimed press still aim; master presses the moved element anyway.

[Cancellation boundaries](reliability-remediation/cc09/cancellation/boundaries/README.md) extends the measured cancellation contract to single-call effects and the capture subprocess: a driver that closed during the aim gets no emission, a screen grab is killed mid-call, and a successor is admitted after; master sends the chord anyway.

[Fresh watch membership](reliability-remediation/cc08/README.md) records seam-level RED/GREEN verification of reparenting, recovered parent reads, bounded climbs and pending-close suppression; live native reparenting proof remains deferred.

[Native cost baseline](reliability-remediation/cc09/README.md) records built-daemon queue and real Xvfb capture phase measurements with fixed content-free counters; no latency SLA or production-load claim. [Native notification and cancellation measurement boundaries](reliability-remediation/cc09/native-measurement-boundary.md) records source-verified follow-up design, not native timing results. [Native event-to-storage latency](reliability-remediation/cc09/native-latency/README.md) measures ten real Mousepad mutations reaching SQLite with zero model calls (median 8.0 ms request-to-row, polling-inclusive upper bound); no wake claim. [Cancellation ownership and acknowledgement](reliability-remediation/cc09/cancellation/README.md) measures five real Mousepad clears cancelled by driver close: stopped at the next emitted-key boundary, ownership retired in under a millisecond, successor admitted at 24.9/28.2/34.4 ms, emitted count equal to settled loss; keys already accepted by the registry are not retracted. [Recorded rhythm and retention in bytes](reliability-remediation/cc09/load/README.md) replays a native typing/burst trace and sizes throttle retention at its limit (about 117 KB); the trace exposed and repaired a daemon backstop that silenced sustained change. [Live reparenting and root removal](reliability-remediation/cc08/reparent/README.md) moves a GTK text view between frames and windows under a real watch and destroys its window; the watch now ends with `watchEnded` instead of staying "alive" on a vanished element. [Kept for the task, not looped on](reliability-remediation/cc06/wake-policy/README.md) records every unknown-origin pointer for the active task and shows a reactive agent converging to one wake per outside change (13 without the quiet window). [What the daemon retains for a watch](reliability-remediation/cc09/daemon-queue/README.md) measures the daemon's only outbound retention - the socket's writable buffer - at zero for a reading client and 247 KB for 2000 events to a stalled one. [A consumer that stops reading is not written to](reliability-remediation/cc09/stalled-consumer/README.md) is the decision on that measurement (ADR-0106): past 256 KiB unsent the watch holds the newest pointer per element until the pipe drains; the built daemon holds 262 KB flat across 8,000 events instead of ~1 MB. [A watch that ended says nothing more](reliability-remediation/cc04/framework/README.md) runs a real `Agent` with `LibSQLStore` notification storage: on master a pointer held when the tool ended the watch still woke the thread (`x2` after `ended: true`); now the shared ledger ends the watch and the throttle forgets it, keeping only `watchEnded`. [Degraded coverage says so at the root](reliability-remediation/cc08/health/README.md): a change the stream cannot place is a content-free `changed` on the watched root instead of silence. [An uncertain keystroke is never sent twice](reliability-remediation/cc02/adapter-retry/README.md) counts keyboard emissions at the D-Bus seam through the real daemon, transport and tool: one whether the answer is unverified or the re-read fails, two under a retrying adapter.

[Mousepad monitor repair](mousepad-verified-find-replace/monitor-repair/README.md) records failure persistence and owned-process teardown proof, not task acceptance.

[Mousepad and remediation follow-ups](mousepad-verified-find-replace/FOLLOWUPS.md) records remaining acceptance and roadmap gaps.

[Mousepad runtime discovery repair](mousepad-verified-find-replace/discovery-repair/README.md) records the regression repair, fresh forced gates and quota-blocked live batch.

[Separate Anthropic Mousepad series](mousepad-verified-find-replace/anthropic-series/README.md) records provider-bound validator proof, final mutation gates and the rejected rate-limited batch; not live acceptance.

[Paced Anthropic Mousepad experiment](mousepad-verified-find-replace/paced-series/README.md) records bounded transport retries, cancellation and installed-SDK interception checks; not desktop acceptance.

[Protocol-shaped Mousepad readback](mousepad-verified-find-replace/readback-repair/README.md) distinguishes genuinely missing post-save evidence from a content-only response discarded by the validator.

[Bounded 32-step experiment](mousepad-verified-find-replace/budget32/README.md) tests additional completion steps with unchanged deadlines and acceptance oracles; all live attempts are retained separately.

[Pre-response fetch recovery](mousepad-verified-find-replace/fetch-retry/README.md) retains one complete machine/visual-reviewed 32-step batch, actual recovered provider failures, installed-SDK RED/GREEN proof and explicit remaining human/reopen boundaries.

[Original 24-step retry](mousepad-verified-find-replace/original24/README.md) retains the rejected first original-budget batch, its step-exhaustion diagnosis, the instruction repair, and a fresh 24-step batch that is machine, oracle and frame-sampled-visual GREEN on all three trials (human approval pending).

[Saved-document reopen diagnostic](mousepad-verified-find-replace/reopen/README.md) records a blocked public Open action in a fresh native process, without claiming successful reopening.

[Rejected semantic Open peer diagnostic](mousepad-verified-find-replace/semantic-open/README.md) retains three failed native trials and the reverted experimental patch without claiming a production fix.

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
| [Explicit field labels and verified form completion](field-mapping-form-completion/README.md) | Bounded native label evidence, deterministic base RED/candidate GREEN, five verified receipt trials and one exo-desktop-item-edit direct-label completion; retained failures and limits, not general reliability |
| [Invalid concurrent gates](field-mapping-form-completion/phase4-gates/concurrent-gates-invalid.md) | Why mutation/build overlap is invalid and serial gates replace it |
| [Readiness retry hypothesis](field-mapping-form-completion/phase4-gates/readiness-hypothesis.md) | Historical ordinary-app readiness investigation |
| [Editable-role retry hypothesis](field-mapping-form-completion/phase4-gates/role-hypothesis.md) | Historical text/textbox coverage investigation |
| [Dialog-role retry hypothesis](field-mapping-form-completion/phase4-gates/dialog-hypothesis.md) | Final application-neutral dialog/window distinction |
| [Final model batch and all retained outcomes](field-mapping-form-completion/phase4.md) | Final five-receipt/one-launcher batch, 44 candidate sessions, reproduction and high-risk review paths |
| [Model trial ledger and limits](field-mapping-form-completion/phase3.md) | Every Phase 3 attempted batch, public confirmation readback and ordinary-app oracle |
| [Historical model receipt transfers](model-desktop-task-2026-09-06/README.md) | Three retained prompt-only RED trials preceding native label observations |
| [Bounded connection startup](connection-startup-2026-09-06/README.md) | One startup deadline, real stalled-peer teardown including an uncooperative WebSocket, and explicit healthy recovery; see retained transcripts for measured results |
| [Native desktop restoration](native-restoration-2026-09-06/README.md) | Real GTK text readback, independently verified visible screenshot pixels and button callback through the public WebSocket API; restoration GREEN, not merge-base RED |
| [Architecture audit boundary evidence](architecture-audit-2026-09-05/README.md) | Source-backed capture ownership and handover lifecycle defects, with explicit distinction between defect reproduction and corrected regression evidence |
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
| [the desk wakes the agent](the-desk-wakes-the-agent.md) and its [desktop screenshot](the-desk-wakes-the-agent.png) | P2 — an agent installed from a tarball subscribes, stops calling tools, and is woken by a change a human typed at the desk; zero frames from the agent and zero requests in the daemon audit log between subscribe and wake |
| [what the face renders](what-the-face-renders.md) and its [rendered PNG](m4-face-rendered.png) | Q22's appearance half — the built lane-to-renderer path paints the orb and current caption over a composited transparent background. Produced on the repository's two-output X11 desk by the command recorded in the receipt; machine pixels and Jamie's minibeast witness agree |
| [any app the machine has](any-app-the-machine-has.md), with its [red](any-app-the-machine-has-without.txt) and [green](any-app-the-machine-has-with.txt) transcripts | The launch gap, as behaviour — a base daemon refuses to start Kate and Mousepad by the names it itself reports, and the same errand against this branch starts both and reads them. Produced by `infra/webtop/generic-launch/proof.sh` |
| [is it already open](01-what-is-running.md), with its [red](01-what-is-running-without.txt) and [green](01-what-is-running-with.txt) transcripts | Installed versus running (issue #53), as behaviour - against the base daemon a model says UNKNOWN twice, including with the editor open in front of it; against this branch the same errand reads not-answering, opens it, and reads answering. Produced by `infra/webtop/01-what-is-running/proof.sh` |
| [can the desk be heard](02-can-the-desk-be-heard.md), with its [red](02-can-the-desk-be-heard-without.txt) and [green](02-can-the-desk-be-heard-with.txt) transcripts | A deliberately deafened machine - `org.a11y.Status` switched off on a real desktop. The base daemon offers no route and the model reaches the right word through a fabricated reason; this branch reports the layer disabled in one call, and an operator-flagged daemon switches it on and re-reads the state. Produced by `infra/webtop/02-can-the-desk-be-heard/proof.sh` |
| [who may close a window](03-who-may-close-a-window.md), with its [red](03-who-may-close-a-window-without.txt) and [green](03-who-may-close-a-window-with.txt) transcripts | A real editor holding unsaved work, and an operator who chose `graceful`. The base daemon rejects the operator's restart block outright and has no restart route; this branch refuses by default naming the setting, is blocked by the editor's own "Close Document" dialog and says so while leaving it running, and restarts a file manager that has nothing to lose. Produced by `infra/webtop/03-who-may-close-a-window/proof.sh` |
| [a key, addressed to one element](04-a-key-addressed-to-one-element.md), with its [red](04-a-key-addressed-to-one-element-without.txt) and [green](04-a-key-addressed-to-one-element-with.txt) transcripts | The errand the desktop-literacy sweep could never finish: renaming a file, which commits on Enter. The base daemon has no key route; this branch refuses the key for want of authority and names the flag, then - armed - refuses it again because this machine's accessibility interface accepts a key and delivers nothing, measured against a control keystroke that moved the same window in the same second. The file is untouched in all three runs. Produced by `infra/webtop/04-a-key-addressed-to-one-element/proof.sh` |
| [what the desk does not teach](errands/baseline/FINDINGS.md), with its [eighteen transcripts](errands/baseline/) | The baseline red for desktop literacy — six errands stated the way a person states them, three runs each, against the shipped instructions unchanged. Two of eighteen completed; six runs never called a tool at all (counts re-collected on the fixed desk; see the comparison). Every failure is classified as prose or surface with the transcript line that decides it. Produced by `infra/webtop/errands/run-errands.sh` |
| [what the desk taught the instructions](errands/after/COMPARISON.md), with [thirty-six transcripts](errands/) | Desktop literacy, measured. The same six errands run three times each under the shipped instructions and under the rewritten ones, on one desk in one sweep: two of eighteen completed becomes eight, six runs that never called a tool becomes zero, and two runs that claimed unfinished work becomes none. Records what prose could not fix, the point where better prose walks an agent into a genuine protocol limit, and two harness bugs that were masquerading as agent failure. Produced by `infra/webtop/errands/run-errands.sh` |

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

[CDP liveness and truth](cdp-liveness/README.md) (ADR-0114): with a real Chrome, base `bb9b89c` hangs on a spinning page and on dialogs, exposes its stream to page forgery, and reports React writes that never reached state; the branch refuses in 1.5 s or a few ms, keeps the stream out of reach, and succeeds only when the reread matches after the settle window.

[Socket ownership](socket-ownership/README.md) (ADR-0115): on `master` a second daemon deletes the live socket and takes the path; the branch refuses and the first keeps serving.

[Element memory](element-memory/README.md) (ADR-0116): on `master` 50,000 answered ids are all held; the branch holds the 10,000 cap.

[Stalled answers](stalled-answers/README.md) (ADR-0106 amendment): on `master` a non-reading client made the daemon retain ~49 MB of answers; the branch stays under the bound and delivers every answer in order.

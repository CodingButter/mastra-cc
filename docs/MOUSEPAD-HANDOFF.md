# Mousepad checkpoint handoff — September 7, 2026

## Latest checkpoint: the original 24-step budget passes on all three trials

The [original 24-step batch](proofs/mousepad-verified-find-replace/original24/README.md) is GREEN under `model-batch.mjs --review`: exact saved bytes, fresh post-save readback (calls 23/21/22) and frame-sampled visual review on t1–t3 in one fresh, unpooled Anthropic batch. The earlier trial 1/2 failures were step exhaustion on redundant field readbacks and an unrequested menu; the repair is an instruction change pinned by a RED/GREEN prose test. Visual inspection is frame-sampled (checkpoint stills plus a 1 fps contact sheet of the actual recording, Claude Sonnet 4.5, with Wren's direct view of the full-resolution checkpoints); native video inspection was unavailable without a valid Gemini credential. Human approval remains pending.

## Previous checkpoint: complete bounded 32-step batch passes machine and model-assisted visual review

The [fetch-retry experiment](proofs/mousepad-verified-find-replace/fetch-retry/README.md) recovered real pre-response connection failures in t1 and t2 without replaying desktop calls. All three trials in one unchanged-artifact 32-step batch passed exact saved bytes and fresh post-save readback; actual Gemini video/image inspection and explicit journal/oracle reconciliation then passed the unchanged visual validator. The final receipt is GREEN with human approval PENDING. 128 artifacts are hash-verified; 114 focused tests, 19/19 forced workspace tasks and 231 full-suite plus three targeted mutations pass.

Visual inspection is attributed to Gemini, not a human or Wren's unavailable direct image viewer. Initial suffix/punctuation misreadings and their scoped resolutions are preserved. Video does not establish saved bytes or Unicode identity; those remain owned by the independent exact-file/public-readback oracles. This is the separate 32-step experiment, not proof of the original 24-step limit. The separate [public reopening probe](proofs/mousepad-verified-find-replace/reopen/README.md) now opens all three saved paths in fresh native processes and requires exact public readback plus unchanged source bytes. It uses the visible File menu and an explicitly granted element-bound pointer route; semantic Open accessibility blocking remains unresolved. Human approval and original 24-step acceptance remain outstanding; native CC-09 persistence latency/cancellation acknowledgement also remain separate follow-ups.

## Earlier checkpoint: bounded 32-step experiment; provider connection failures block full-batch acceptance

The [32-step experiment](proofs/mousepad-verified-find-replace/budget32/README.md) predeclares eight additional steps while retaining the 180-second deadline and all acceptance oracles. The driver forwards the declared budget into actual generation; three driver smoke tests and 98 evidence tests pass, with 19/19 forced workspace tasks and 231 caught mutations. The new runtime test fails against the previous driver.

Two fresh unchanged-artifact batches were retained separately, 75 hash-verified artifacts each. First batch: t1/t2 passed exact save and fresh readback; t3 failed with provider connection closure. Second batch: t2/t3 passed exact save and fresh readback; t1 failed with the same connection error. Every normally completed trial used 25–28 tool calls and finished normally; all cleanup verified. Neither complete batch passed, and successes are not pooled. Next investigate bounded pre-response fetch rejection handling without replaying agent/tool calls. Visual/reopen acceptance remains outstanding.

CC-09 follow-up source inspection confirms client close is not native cancellation acknowledgement. The native container runner is unavailable here; an isolated-Xvfb no-model persistence measurement design is documented in the reliability worktree, not claimed as a measured native result.

## Earlier checkpoint: readback validator repaired, all three save, acceptance BLOCKED

The prior t3 rejection was a validator defect: `readElementContent` returns content without an element wrapper. It now binds that response to the requested ID's preceding public text-element evidence, retaining exact-text and after-save ordering checks. Prior t1 really lacked post-save readback. Six new positive/negative regressions cover the distinction, and mirrored instructions address observed scope-toggle search overhead.

In the new complete batch, all three trials saved exact bytes; t2/t3 passed the fresh-document machine oracle at call 24. t1 again saved on call 24 without a subsequent read, so the batch remains rejected. All cleanup was verified; no visual approval is claimed. See the [readback repair report](proofs/mousepad-verified-find-replace/readback-repair/README.md), 73 hash-verified artifacts, 112 focused tests, 19/19 forced workspace tasks and 231 mutations caught. Work continued on producer-only CC-09 timing/retention measurements in the separate reliability worktree; native notification and cancellation measurements remain incomplete.

## Earlier checkpoint: paced Anthropic series, task acceptance BLOCKED

The bounded paced series completed all 70 provider requests without quota failure and recorded actual cache hits. This removes provider-rate failure as the explanation for this batch, not the desktop acceptance requirements. t1/t3 saved exact expected bytes but failed the independent fresh-document evidence oracle; t2 exhausted its step budget without saving expected bytes. All owned groups were cleaned up. No visual acceptance is claimed.

See the [paced-series report](proofs/mousepad-verified-find-replace/paced-series/README.md): 74 retained hash-verified artifacts, 106 focused tests, 19/19 uncached workspace gates, 231 full-suite plus seven targeted mutations caught, and installed-SDK interception/retry checks. The original 24-step/180-second limits and all file/UI/visual oracles remain unchanged. Next investigation is bounded interaction efficiency and post-save/reopen evidence, not an unverified demand for more quota. Broader CC-09 measurement work remains separate.

## Earlier checkpoint: unpaced Anthropic series, BLOCKED

The supplied Anthropic key authenticated successfully. A new predeclared t1–t3 batch using `anthropic/claude-sonnet-4-5-20250929` then hit its 500,000 input-token/minute rate limit: t1 after eleven public calls, t2/t3 before any public calls. All saved-file oracles failed; all owned process groups report verified cleanup. No visual acceptance is claimed. Google remains the default; provider selection is allowlisted and metadata must match the declaration. The existing step/deadline/file/UI/visual gates were not relaxed.

The complete post-batch mutation sweep now passes: **231 mutations, none survived**. See the [Anthropic series report](proofs/mousepad-verified-find-replace/anthropic-series/README.md) for final deterministic gate receipts, independent reviews and the retained 72-file rejected batch. No source/build changes overlapped the batch. Authentication success did not establish sustained quota capacity. Investigate bounded, predeclared request pacing/token volume before another complete trial batch; increased quota is an alternative, not a proven prerequisite. Historical Google results and lane ownership below remain unchanged. No push, PR or merge has been performed.

## Earlier outcome: BLOCKED, not approved live completion

Runtime discovery now exposes already-granted native query names without widening observation grants or contaminating launch authority. Fresh deterministic gates pass. Approved real-agent acceptance does not: all three final trials encountered Google HTTP 429 input-token quota exhaustion, failed saved-byte oracles and have no accepted visual review. Do not merge or label Phase 3 complete on this evidence.

## Historical Google checkpoint and ownership (before the Anthropic series)

- Worktree: `/tmp/mastra-cc-mousepad-verified-find-replace`.
- Branch: `feat/mousepad-verified-find-replace`.
- Tested code checkpoint: `ebce7e7fcfdbf6c9df9b97440f8ebd6054734915`. This handoff is a subsequent documentation-only commit; obtain the final checkout HEAD with `git rev-parse HEAD`.
- Shared base: `eecf9659165bda7dc602b54b03e04875403e1e3b`.
- Commits after shared base: `58ae793` (monitor/evidence retention), `49f3740` (rejected retry evidence), `ebce7e7` (runtime discovery, saved-readback guidance, acceptance-validator regressions, quota-blocked evidence), followed by this handoff commit.
- Shared foundation history `70baacc`, `915aefa`, `eecf965` was not rewritten. No protocol/schema or composite-observation implementation changed in this checkpoint. Server application-list construction and mirrored agent instructions changed; integration must reconcile them with reliability's server/instruction edits.
- Publication: these checkpoint commits are local only; no push, PR, merge or remote mutation performed. Existing remote patch equivalence was not assessed.
- Before this documentation commit the worktree was clean, including all seven formerly dirty tracked files and the native regression. No unrelated worktree cleanup or reliability edits occurred.

## Historical Google verification and evidence

The 91-test receipt below belongs to the earlier discovery checkpoint. The current Anthropic checkpoint passed 93 focused tests (`anthropic-series/evidence-final.txt`), 19/19 forced workspace tasks with zero cached (`workspace-final.txt`), 231 mutations (`mutations.txt`) and documentation validation (`docs-final.txt`). These paths are relative to `docs/proofs/mousepad-verified-find-replace/anthropic-series/` except the explicitly prefixed evidence path.

- Fresh `pnpm turbo run build lint typecheck test --force`: 19/19 tasks, zero cached, 15.068 seconds. Retained transcript: `docs/proofs/mousepad-verified-find-replace/discovery-repair/workspace.txt`.
- Focused native replay/discovery regressions: 29 passed. Pre-fix regression transcript: one failure, 27 passed. See `regression-red.txt` and `regression-green.txt` in that directory.
- Evidence/supervisor/lifecycle suites: 91 passed, `evidence-tests.txt`. Exact commands are in the [repair report](proofs/mousepad-verified-find-replace/discovery-repair/README.md).
- Fresh `pnpm check-docs` passed; `git diff --check` passed. Earlier wrong script-path failure is retained and explicitly distinguished from the corrected documentation gate.
- Independent source reviews returned no blocking code/privacy findings; raw reports are retained in `discovery-repair/reviews/`. Those reviews do not certify execution or live completion. Successful docs transcript and repair README resolve their documentation-evidence gaps.
- Live fixed-settings installed-consumer batch: `/tmp/mousepad-handoff.5Wd48F`, exit 1, all three rejected. Native/model-driven attempts are not the scripted replay regressions above. All three driver logs contain the quota failure. No successful trial was pooled or review fabricated.
- Durable copy: `docs/proofs/mousepad-verified-find-replace/discovery-repair/rejected-quota-batch/`, including recordings, public events, declarations, attempts, expected/actual documents and a 72-file SHA256 inventory. Private HOME/runtime and installed dependency trees are excluded. Original paths in immutable evidence still name the original batch.
- Candidate build and harness hashes were checked unchanged by the batch. No build or mutation sweep overlapped it. A secret-pattern scan of retained text found no matches; this is not a comprehensive security audit.

## Resource release

The harness used a run-private display allocated by Xvfb, separate session/accessibility buses, HOME/XDG state, document and daemon socket. It did not drive the human desktop. Every trial reports verified owned-group cleanup. A subsequent process-list check found no command containing the batch directory. No owned live session is known to remain. This does not claim demonstrated concurrent two-lane isolation.

## Smallest dependency to resume

Investigate the observed Anthropic request/token rate before another batch: bounded predeclared pacing is an unverified experiment; increased quota is an alternative. Keep the task, deadlines and acceptance oracles intact. Then run a new complete predeclared t1–t3 batch on unchanged final artifacts and genuinely inspect its recordings/checkpoints. The final-candidate 231-mutation sweep is complete; live acceptance and genuine visual review remain outstanding. Historical failed attempts remain rejected. See [FOLLOWUPS](proofs/mousepad-verified-find-replace/FOLLOWUPS.md).

## Reliability lane: account for next, do not duplicate

The historical roadmap audit covers CC-01–CC-09 only; section 13 is a separate specialist proposal. Existing bounded repairs belong to the reliability branch and were not imported or reimplemented here. This checkpoint does not re-certify that other agent's current branch:

| Item | Existing bounded slice / outstanding full acceptance |
| --- | --- |
| CC-01 | Visible-pixel capture contract recorded as delivered; preserve limitations on ownership/occlusion. |
| CC-02 | Emit-once, explicit uncertainty recorded as delivered; live IME/focus and post-emission-failure characterization remain. |
| CC-03 | Listener generation/lifecycle fix recorded as delivered; preserve lifecycle regressions. |
| CC-04 | Bounded retention/trailing wakes and configured-gap tests recorded as delivered; preserve fairness/privacy coverage. |
| CC-05 | Connection-bound driver ownership delivered; human takeover and native cancellation remain. |
| CC-06 | Request-local identity separated from event causality; task-state accounting and replacement wake policy remain. |
| CC-07 | Conservative refusal of partial native capture delivered; normalized crop provenance/freshness remain. |
| CC-08 | Fresh bounded membership and refused-stream retirement delivered; live reparenting and complete/degraded reporting remain. |
| CC-09 | Queue/capture counters and synthetic workload matrix delivered; representative notification latency, event-loop delay, retained-cache and cancellation measurements remain. |

Coordinate integration of the common foundation once, preserve both branches' evidence, and reconcile overlapping server/prose changes. No authority to merge or independently extract shared commits is implied. Per the finish-and-handoff instruction, the Mousepad lane stops here rather than opening another workstream.

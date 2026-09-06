# Architecture audit defect reproductions — 2026-09-05

Historical reproduction command, run against the pre-correction September 5 source with Node supporting TypeScript type stripping (verified then with Node 25.2.1). It deliberately asserts the defects and is expected to fail against corrected source; it is not the current regression gate:

```sh
node docs/proofs/architecture-audit-2026-09-05/reproduce-boundary-defects.mjs
```

Observed output:

```text
DEFECT REPRODUCED: unrelated containing window chosen for capture.
DEFECT REPRODUCED: timeout returns control without human Done.
```

This script imports current source. It supplies synthetic window metadata to the real capture selector, and invokes the real demo control station in a separate process. It does not touch an actual desktop, take screenshots, enter credentials, or use the network.

**This is a reproduction of historical September 5 defects, not a green correctness test or a merge-base red/green proof.** The assertions deliberately confirm unwanted behavior; successful execution means the defects still reproduce. After correction, replace/supplement it with regression assertions of intended behavior. The capture case proves the geometric candidate-selection error, not a live end-to-end authorization exploit. Only these two defects have executable reproduction here; other audit findings remain source-backed or under investigation.

Related audit notes: `.mastracode/plans/current-architecture-audit-findings.md` and `.mastracode/plans/current-architecture-audit.md` in the repository root.

## September 6 current verification checkpoint

The September 5 reproduction above is historical; it does not describe the restored contract. The following checkpoint records reported verification, not a fresh run by this docs-only refresh.

- Turbo: 19/19 tasks passed **before final review corrections**, not verification of those later edits.
- Mutation runner: 223 entries ran; one runner failure occurred because its report was missing after the supervising shell timed out. This was not a survived mutation or stale anchor. Rerun pending; do not claim an all-green mutation gate.
- Determinism, schema freeze (1.19.0), digest agreement, all five architecture pins, licence checks and documentation checks passed at the earlier checkpoint.
- Live lane: `NO_COLOR=1 bash infra/demo.sh` built an isolated Xvfb desktop and private accessibility bus, read a real GTK button, and passed 12 conformance tests (43 skipped). The transcript is [live-lane.txt](live-lane.txt); its final line is the required `PROOF: GREEN` witness. This proves live accessibility reading/conformance, not native click delivery, element capture, or completion of a model-driven errand.

## Remaining limits

- ADR-0093 supersedes blanket fail-closed containment: practical native capture/click restoration is the current contract. Capture is a VISIBLE root-screen crop with intersection clipping of partially offscreen rectangles; it may include other applications and geometry is non-atomic. Pointer input aims at fresh bounds, not an assured recipient.
- September 6 live GTK text readback, PNG dimensions and button callback: PASS. This is narrower than pixel-content proof; the pixel witness is being improved separately. Live overlap, transparent-overlay and timing behavior remain unproven.
- Actual display-bounds querying is being added to the helper; the desktop `getTools` dispatch guard for cancel/handover during lazy dial is underway. Neither is claimed complete here.
- Transport open/hello while connection is pending has no deadline. Shared-demo concurrency is not production multi-tenant isolation.
- Provider interruption after any tool attempt stops automatic retry. Complete partial tool history and settled in-flight effects are not assumed; a new attempt must re-observe the desk.
- Cancellation must prevent further effects and cancel waits, but the lazy-dial dispatch correction above remains pending; cancellation cannot undo an effect already delivered to the daemon.
- Portable instructions describe conditional techniques, not Chromium/KDE-specific guarantees; installation guarantees belong only to the demo. Instruction checks do not prove human-equivalent model competence. No end-to-end wallpaper success is established.
- These are corrected-state regression results, not a paired merge-base red/green demonstration of every finding.

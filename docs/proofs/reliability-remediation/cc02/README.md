# CC-02: Typing uncertainty and Unicode bounds

Run `bash docs/proofs/reliability-remediation/cc02/demo.sh` from the checkout.

The native scripted-channel suite calls the actual backend and counts emissions: Unicode, selected replacement, middle insertion, truncation, same-length wrong text and delayed/unavailable publication must remain explicitly unverified, with one emission only. The server suite verifies validation occurs before effect, retains the UTF-16 boundary and preserves diagnostic evidence. This is not live IME or selection proof.

`without.txt.gz` retains the final native regression suite run with only `daemon/src/backends/atspi/index.ts` restored from `59aca74` (13 failures, including incorrect Unicode and replacement refusals). The candidate source was restored in `finally` before rerunning GREEN; all other files remained candidate files. `with.txt.gz` records the final executable proof. `workspace.txt.gz` records the forced build/lint/typecheck/test run. `mutations.txt.gz` records focused diagnostic-removal and duplicate-input mutations.

See [ADR-0098](../../../02-DECISIONS/0098-typing-attempts-are-not-insertion-proofs.md). No exact insertion verification, automatic clear or automatic resend is claimed. Native post-emission exception/focus restoration and live input-method characterization remain follow-ups, as does Mousepad visual acceptance.

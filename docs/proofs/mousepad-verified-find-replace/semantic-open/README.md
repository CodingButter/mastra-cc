# Semantic Open: rejected application-peer diagnostic

## Verdict: RED — not a production fix

A temporary channel experiment sent each `org.a11y.atspi.Action.DoAction` over a fresh application-advertised local peer connection, while leaving other exchanges on the accessibility bus. The driver used public `activateElement` for Open instead of the previously successful public-pointer route. The experiment was enabled with `MASTRA_CC_ACTION_PEER_PROBE=1`. The exact unshipped source delta is retained in `rejected-peer-probe.patch`.

The fresh batch `/tmp/mousepad-reopen.4j26_kjr` rejected all three trials. Each reached the file chooser, exposed its location field, and returned from setting the saved pathname. Each then reported a backend read failure at journal sequence 24 (`sendKeyChord`), and each session reached the runner's 90-second bound with exit 124. Every source document remained unchanged. This does not establish successful reopening or cancellation acknowledgement.

The daemon logs identify a timed-out `Accessible.GetRoleName` exchange. Moving the action onto a new peer allowed earlier interactions to proceed but did not solve the end-to-end failure. Do not ship connection switching, retry native actions, or classify these timeouts as application death based on this diagnostic.

## Retained evidence

`rejected-peer-batch/inventory.json` binds compressed journals, daemon/application logs, recording, declaration, driver, and outcomes to original and retained SHA-256 hashes. Retention used the existing reopen retention script and checked its credential patterns. The runner kills its owned session process groups in its `finally` block; that cleanup is not a native-operation cancellation protocol.

The experimental production-source and driver edits were reverted after the batch. The restored daemon was rebuilt. All 19 forced workspace build/lint/typecheck/test tasks passed, documentation checking passed for 309 files, and all 67 retained artifacts were independently hash-verified. Gate receipts are `restored-gates.txt.gz` and `docs-check.txt.gz`. No new mutation sweep was run for this rejected experiment. The patch is an experiment receipt, not an applied fix.

## Remaining investigation

The local AT-SPI source checkout identifies itself as `AT_SPI2_CORE_2_52_0`, commit `46c8de80022d28eef2da58f1054b5bff745ed7e0`. In `atk-adaptor/adaptors/action-adaptor.c`, `impl_DoAction` sends a positive reply before calling `atk_action_do_action` synchronously. That ordering is a source observation, not proof of the complete timeout mechanism. A native bridge scheduling experiment would need to preserve object lifetime and test modal actions without weakening daemon readback.

A separate, non-installed Meson build attempt stopped at missing `libxml-2.0` development metadata. No system packages or native bridge libraries were installed or replaced. Native bridge repair, original 24-step model acceptance, genuine event-to-storage latency, and cancellation acknowledgement remain open; the successful public-pointer reopen proof remains separate.

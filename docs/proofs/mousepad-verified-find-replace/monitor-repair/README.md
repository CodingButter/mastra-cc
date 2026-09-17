# Bounded batch-monitor repair

September 7, 2026. This is harness lifecycle proof, not Mousepad task acceptance.

Run from the checkout root:

```sh
node docs/proofs/mousepad-verified-find-replace/monitor-repair/demo.mjs
node --test docs/proofs/mousepad-verified-find-replace/model-supervisor.test.mjs docs/proofs/mousepad-verified-find-replace/model-lifecycle.test.mjs
pnpm turbo run build lint typecheck test --force
```

The rejected batch `/tmp/mousepad-model.ZA1hPS` crashed with `ECONNABORTED` while enumerating `t3/runtime/doc/by-app`, leaving no t3 attempt record. `demo.mjs` reproduces the old unguarded callback in a disposable subprocess (not a pre-fix Git checkout), then invokes the actual batch lifecycle with harmless subprocesses, induces the same monitor error, reads the persisted failure and following independent-session records, and checks owned-group cleanup. Deterministic regression tests are separate. `proof.txt` retains both distinctions. `workspace.txt.gz` retains forced workspace gates.

The scanner counts regular files on the root device, skips links and different-device mounts, and refuses on other scan errors. This is not detection of same-device bind mounts. Session and aggregate artifact limits remain enforced. Monitoring errors stop the owned process group instead of escaping the timer callback. Ordinary failures produce per-trial evidence and do not prevent independent trials. Interruptions and unverified cleanup abort remaining trials with explicit not-started records.

TERM gets the existing 15-second grace while the leader lives. Leader exit triggers immediate KILL of remaining group members. After escalation, waiting for leader exit is bounded; cleanup verification has an additional two-second bound. Linux `/proc` must show no active process-group members; zombies are not executing work. Tests include real stubborn child/grandchild teardown, missing executable, log-open failure, monitor failure, subsequent success, and an actual SIGTERM during a controlled cleanup-check barrier with persisted interrupted/aborted evidence.

Limitations: synchronous filesystem calls cannot guarantee responsiveness against arbitrary kernel/filesystem stalls; processes deliberately escaping the owned process group are not covered by this group proof. An unwritable/full evidence filesystem can still prevent persistence and must be reported as infrastructure failure, never acceptance. No grants, model settings, deadlines for model execution, or acceptance oracles were relaxed. Prior unaccepted driver/evidence harness files are retained as dependencies of the batch entry point; this commit does not certify them as live completion proof.

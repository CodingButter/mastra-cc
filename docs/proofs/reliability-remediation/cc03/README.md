# CC-03: signal startup and shutdown

Baseline commit: `eecf965`. Implementation branch: `fix/reliability-remediation`.

The actual `DesktopSignals` class is exercised with controlled client promises and retained listener callbacks. No provider API or native desktop is required. The existing real-socket push tests remain part of the GREEN command.

## Reproduce

```sh
bash docs/proofs/reliability-remediation/cc03/demo.sh
```

- RED: before changing production source, 7 of 8 lifecycle tests failed, including duplicate registration, late attachment after stop, stale callback delivery and unhandled delivery rejection. `without.txt.gz` retains the test output.
- GREEN: 8 lifecycle plus 13 existing real-socket/stream tests pass. `with.txt.gz` retains the output.
- Mutation proof: all 10 signal mutations killed, including removed startup coalescing, removed generation invalidation and unguarded retired callbacks. `mutations.txt.gz` retains counts; the old no-listener mutation was relocated to the new acquisition site, not removed.
- Final fresh workspace gates: 19/19 build/lint/typecheck/test tasks passed, zero cached; `workspace.txt.gz`.
- Baseline attempt: one unrelated existing graceful-window-close test failed under the first full concurrent run (`who-may-close-a-window.test.ts:271`). Retained in `baseline-attempt.txt.gz`; the later forced full run passed without changing daemon source. This is a timing-risk follow-up, not a bug claimed fixed here.

## Ownership and restart contract

Concurrent `start()` calls share acquisition. `stop()` retires the pending/current generation synchronously and detaches only its listener. Old completion and callbacks cannot attach or notify after retirement. Failed acquisition propagates to the caller and allows retry; cleanup of an old failed attempt cannot clear a newer one.

The installed Mastra core implementation (1.63.2, `dist/signal-provider-BzuATi37.js:269-288`) stops polling and clears inherited subscriptions but keeps the connected agent. This fixed-target push provider can attach a fresh listener after stop. It does not restore inherited subscriptions, close the shared transport, retract submitted notifications or await delivery settlement. These boundaries are tested, not treated as atomic cancellation.

Delivery rejections are handled at the callback boundary. A content-free warning is emitted at most once per listener generation; subsequent failures are suppressed, with no automatic retry. The error object's potentially private content is not logged.

## Remaining roadmap

CC-01 capture descriptions: source mismatch confirmed, pending correction and generated-contract tests. CC-02 typing verdicts: native scripted-channel reproduction still required. CC-04–09 and specialist integration are not implemented or verified here. Mousepad's live/visual acceptance remains separately blocked and is not weakened by these offline gates.

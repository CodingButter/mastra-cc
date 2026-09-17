# CC-06 — Unknown event origin, independent raw delivery

## Reproduce

```sh
pnpm exec turbo run build
node docs/proofs/reliability-remediation/cc06/demo.mjs
```

The demo imports built daemon, transport and desktop signal-provider artifacts. Two real Unix listeners serve independent scripted backends with the same application name. Two connections watch the first desktop and a third watches the second. Each receives a pointer before, during and after an operation. Response barriers drain the corresponding socket traffic; no sleeps or native timing guesses are used.

GREEN requires all nine pointers to survive, all origins to be `unattributed`, no cause IDs and zero default planning-notification attempts. The notification sink is synthetic: this proves attempted wakes, not framework persistence or live agent behavior. Realer native input would not add causal evidence to the protocol, and no native execution claim is made.

The optional argument selects another built checkout. The retained baseline is 00a9ad1, before CC-04/05 as well as CC-06: both changes are documented rather than presented as the immediate parent. On identical input, all baseline streams are external/self/external, including the independent desktop; three cause IDs and three default wake attempts appear. The attribution regression is independently reproduced against immediate pre-fix source before editing.

## Artifacts and boundaries

`with.txt` and `without.txt` retain built-demo transcripts. Compressed test, mutation and workspace transcripts record separate verification gates; tests are not the demonstration. Existing visibility checks remain required. Audit request identity is not event provenance.

The conservative external-only default is unchanged, but native streams are now unknown-origin and therefore do not wake planners automatically. Raw client listeners still receive them for active-task use. Explicit unknown-origin notification opt-in is tested separately, not advertised as loop-free. Whole-task state accounting and safe idle-wake integration remain follow-ups; so do human takeover, native cancellation and Mousepad visual acceptance.


## Task-state accounting and the wake-loop breaker

[`wake-policy/README.md`](wake-policy/README.md) adds the ObservationLedger (every pointer kept for the active task, no wake) and the quiet window after this session's own effects, and shows against built artifacts that a reactive agent with unknown-origin wakes opted in converges to one wake per outside change instead of looping.


## Across a driver transfer, and what "revocation" is

`daemon/src/__tests__/a-watch-dies-with-its-driver-and-the-next-driver-looks-fresh.test.ts`
runs a real daemon with two connections: A watches an element and starts an
effect; A disconnects mid-effect. A's watch is closed at the backend at once.
B's effect is refused at the ownership gate while A's effect still runs; B's
watch request is queued behind that effect (every backend call is serialised)
and answered only after the tail has landed - so B hears nothing of A's tail
and must look. B then drives, and its own effect is narrated to its own watch
as `unattributed`: the daemon has no causal witness on the native bus and does
not guess, even for the driver.

Visibility revocation mid-task does not exist as a runtime path: `Visibility`
is a `ReadonlySet` composed at boot (`daemon/src/grants.ts`). Revoking a grant
is a daemon restart, which ends every connection and therefore every watch;
the consumer's ledger keeps what it recorded and receives nothing further.
That is the whole lifecycle, and it is recorded here rather than tested
because there is nothing to test that the connection-close tests do not
already cover.

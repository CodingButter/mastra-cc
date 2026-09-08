# Native notification and cancellation measurement boundary

Investigated September 7, 2026. This is a source-verified measurement design, **not a GREEN native latency or cancellation receipt**.

## Existing native notification proof

`infra/webtop/signals/wake-on-change.mjs:47-69` creates LibSQLStore, attaches DesktopSignals via Agent signals, registers the agent with Mastra, and provisions a matching thread through Memory. Its later generation/wake phase is unsuitable for measuring storage latency without model activity. The historical proof in `docs/proofs/the-desk-wakes-the-agent.md` measures event rate and wakes, not per-event end-to-end latency; its historical attribution description predates current unknown-origin policy.

The existing container runner could not run here: Docker returned a missing `/run/user/1000/docker.sock`. This does not establish that native measurement is impossible: the Mousepad lane already uses isolated Xvfb, so a separate no-model driver can reuse that isolation after adapting storage setup.

Required next experiment:

1. Use an isolated native GTK document and real daemon, one authorized transport connection, real DesktopSignals, real notification storage and an explicitly scoped target. Explicitly opt into unattributed events only for this measurement; production defaults stay unchanged.
2. Verify the installed Mastra notification policy configuration and force record-only persistence at its highest-precedence decision seam. Do not use inbox read, which may deliver signals, or silently replace the connected agent with a recorder stub.
3. Timestamp native mutation injection separately from daemon event receipt. Native injection-to-storage observation includes compositor/accessibility dispatch; `ChangeEvent.at`-to-storage observation starts later and must be reported separately. Use monotonic clocks in one process where possible; report cross-process clock assumptions.
4. Read the actual notification storage domain with bounded polling. Report polling-inclusive upper-bound latency, not precise database commit time. Correlate each sample to fresh state/unique target: merely finding a pending coalesced record may match a previous sample.
5. Settle notification work before stopping, close the owned connection and process group, retain hashes and cleanup evidence. No model generation or user desktop mutation is required.

The initial expert guidance did not establish installed-version configuration nesting or adapter initialization. A later runnable `storage-smoke.mjs` now verifies that setup against the installed CLI dependency tree: real Agent, Memory, SignalProvider and LibSQLStore, explicit thread provisioning, highest-precedence `notifications.deliveryPolicy.decide: () => 'persist'`, awaited notify, and direct notification-domain readback. The receipt in `storage-smoke.json` records the resolved module paths. It asserts one pending record with zero delivery attempts while replacing global fetch with a throwing counter and requiring zero calls. Run it with the absolute path to the installed CLI's package.json as its argument.

This is a **synthetic provider-to-real-SQLite setup check**, not DesktopSignals/native event-to-storage latency, a percentile/SLA, cancellation acknowledgement, or proof for the older locked Mousepad runtime. The real native pipeline and correlation experiment above remain required. Its single elapsed value includes notification handling and readback and must not be relabeled native latency.

## Cancellation is not represented by client close

Source checked in this worktree:

- `packages/transport/src/index.ts:153,386`: public close ends the wire; no per-request AbortSignal or cancellation operation is exposed by this client interface.
- `daemon/src/server.ts:2723-2727`: connection teardown disconnects driver authority and initiates watch closure without awaiting it. This is not a native-operation cancellation receipt.
- `daemon/src/backends/atspi/capture.ts:191-225`: the native capture subprocess helper has its own timeout/output limits and SIGKILL path. It has no caller AbortSignal parameter and rejects before independently observing child exit on the failure path.

Consequently the existing producer stop measurements cannot legitimately be renamed native cancellation responsiveness. A useful bounded experiment should separately timestamp client rejection, daemon watch teardown, and native child exit. Full operation cancellation requires an explicit cancellation ownership/acknowledgement contract before an SLA can be measured. Do not add a guessed deadline or treat wire closure as that contract.

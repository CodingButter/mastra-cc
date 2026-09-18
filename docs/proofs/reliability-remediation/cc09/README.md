# CC-09 — initial content-free native cost baseline

The [native measurement boundary](native-measurement-boundary.md) records verified notification-storage and cancellation seams, the unavailable container runner, and the isolated-Xvfb alternative. It is a follow-up design, not measured native latency.

## Producer signal workload measurements — September 7, 2026

```sh
node --experimental-transform-types docs/proofs/reliability-remediation/cc09/producer-measurements.mjs
```

`producer-measurements.jsonl` records four real-clock producer workloads: unthrottled burst, repeated hot key, 10,000-key overflow burst and a 1,750 ms hot-key gap. It imports the actual SignalThrottle source; the receipt records its SHA256 and Node version. This Node invocation uses experimental TypeScript transformation. Another isolated Mousepad proof was running on the same host, so these are observed workload samples, not controlled production benchmarks.

The boundary is **producer ingress to synchronous delivery callback**, not native event emission to persisted Mastra notification. Retention is measured in pointers, not heap bytes or native queue size. Local `stop()` timing is not native cancellation responsiveness. The histogram covers the entire case, including waits and post-stop observation. Latencies describe delivered observations only; coalesced/evicted events and pending backlog have no invented delivery time. Quantiles select sorted zero-based index `floor(n*q)`, clamped to the last observation: for two deliveries, the reported p50 is the upper value, not an interpolated median. This small-sample convention is recorded rather than implying a production distribution.

Observed peak retention was 0 / 1 / 257 / 1 pointers. The overflow burst delivered 64 observations (including one broad invalidation), still held 256 pointers at the deliberate stop, and observed a 128.7 ms maximum event-loop delay. Local stop calls took 0.007–0.117 ms; all retained pointers were cleared, a post-stop push was ignored, and no further delivery occurred during the following 1,100 ms. These numbers are measurements, not thresholds. The run asserts bounded retention, exact unthrottled delivery count, finite nonnegative delivered latency and stopped-producer behavior.

End-to-end native notification latency, native cache/queue byte sizing and native operation cancellation remain explicit follow-ups. No RED speed comparison is appropriate because this script measures existing behavior rather than changing it.

After building, from the repository root:

```sh
xvfb-run -a -s '-screen 0 200x150x24' node docs/proofs/reliability-remediation/cc09/demo.mjs
```

This script imports the built daemon library and calls its public request handler. Eight concurrent capture requests use the existing serial queue. Pixels come from actual Xvfb/xwd decoding and PNG encoding; accessibility geometry and identity use a scripted/replay channel. This is not a real application's accessibility geometry or a representative production workload.

`with.txt` is the initial measured baseline, not evidence of a speedup. All six fixed counters must contain exactly eight attempts, capture bytes must be positive, and every response must contain the requested complete image. Unit regressions separately verify failed work, exact clock arithmetic, detached snapshots, bounded cardinality and queued request instrumentation. `workspace.txt.gz` and `mutations.txt.gz` contain verification results.

Metrics are cumulative for the process: milliseconds for queueWait, requestWork, captureAcquire, captureDecodeCrop and captureEncode; bytes for captureBytes. Request work includes all queued callback work. PNG bytes exclude base64 and the wire envelope. Event-loop maximum delay is measured by this demo, not retained by the daemon. No image bytes, identifiers or text are printed.

No RED speed comparison is supplied: this introduces observability, not an optimization. No budget is selected from this tiny fixture. The workload matrix below extends capture-load coverage; notification latency, retained native queue sizes, cancellation responsiveness and full transport/serialization attribution remain explicit follow-ups in ADR-0104.

## Native workload matrix — September 7, 2026

```sh
python3 docs/proofs/reliability-remediation/cc09/matrix.py . > matrix.jsonl
node docs/proofs/reliability-remediation/cc09/verify-matrix.mjs matrix.jsonl
```

Requires the built workspace, Xvfb/xvfb-run/xwd, and Python GTK 3/Cairo bindings. The runner creates private displays at 1280×720, 1920×1080 and 3840×2160. GTK is explicitly forced to X11, and its display identity is checked before opening a window: inheriting Wayland otherwise paints the wrong display. An initial run was rejected for this reason, not retained as successful evidence. The first successful capture in each case is decoded and checked against known sidebar/table colors or seeded noise pixels and variation. Later captures retain the size/entropy sanity check. A solid PNG larger than the old size-only check is explicitly rejected by a regression test. Oversized noisy captures must produce the actual size-limit refusal, not an arbitrary failure. The GTK accessibility bridge is disabled for these pixel-only fixtures.

The 24 cases cross synthetic table-like pixels / seeded noise, 320×180 / full-display captures, and one / four outstanding requests. Each fresh Node process makes one first-request measurement, two warmups, then twelve measured captures. It uses a real Unix transport client and server with native pixels; accessibility identities and geometry remain scripted. A query is queued behind each capture batch to expose shared-queue interference. Full noisy 1080p and 4K images must be refused by the existing 4 MiB encoded-image limit. These are workload classes, not a claim to reproduce real application usage or a production latency distribution.

Artifacts:
- `matrix-with.jsonl` and `matrix-with.txt`: complete instrumented observations and validated summary.
- `matrix-without.jsonl` and `matrix-without.txt`: the same native workloads on pre-instrumentation commit `b4a2291`; the evidence gate is deliberately RED because phase counters are absent. This is **not** a performance regression or speedup comparison.
- `matrix-tests.txt.gz`, `matrix-workspace.txt.gz`, `matrix-mutations.txt.gz`: validator tests and final gates.

The measured sample set contains 288 timed captures, plus 72 first/warmup captures. Counts and exact successful PNG byte totals are checked against phase counters. Twelve samples make nearest-rank p95 equal to the observed maximum; query batches at concurrency four have only three samples. First-request timing is process-cold, **not** filesystem/OS-cold. Counter totals include the first request and warmups; event-loop monitoring starts after first-image pixel validation and includes warmups. Capture latency distributions and wall time exclude the first request and warmups. `maxRssKiB` is the in-process daemon/client high-water RSS, not the renderer/X server/xwd process tree. `responseJsonBytes` counts capture result JSON only, including base64; it excludes framing, other responses, and transport-copy costs. Phase totals are nested, never additive.

The runner owns a fresh process group per display and terminates the whole group on timeout or interruption, not only the shell wrapper. `python3 docs/proofs/reliability-remediation/cc09/check-cleanup.py` forces a helper timeout with a child and grandchild; `matrix-cleanup.txt` records that neither remains active. This is a process-lifecycle regression, not a desktop cancellation guarantee.

In this run, 4K table-like full captures at concurrency four reached 616 ms capture p95 and 617 ms queued-query p95. Full noisy 4K refusals reached 2,685 ms capture/query p95 with a 632 ms observed event-loop maximum delay. Even refused captures therefore incur acquisition, decoding and encoding costs. These values motivate further investigation; they are not safety limits or an SLA. Actual application distributions, separate-process client overhead, event-to-notification latency, queue retention and cancellation responsiveness still need separate measurement. Deployment must still authenticate/protect remote access and isolate desktop driver authority; element grants are not pixel or physical-input isolation.


## Recorded rhythm and retention in bytes

[`load/README.md`](load/README.md) records a native typing and replacement-burst trace from one Mousepad desk, replays it through the consumer throttle, and sizes retention at the 256-pointer limit in GC-differenced heap bytes (about 117 KB). The first trace exposed a daemon backstop that silenced sustained change; it is repaired and pinned there.

## A consumer that stops reading

[`stalled-consumer/README.md`](stalled-consumer/README.md) is the decision (ADR-0106) on the unbounded retention `daemon-queue/` measured: past 256 KiB unsent toward one connection, its watches hold the newest pointer per element and deliver on drain. Retention flat at 262 KB across 8,000 events on the built daemon.

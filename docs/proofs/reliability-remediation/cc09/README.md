# CC-09 — initial content-free native cost baseline

After building, from the repository root:

```sh
xvfb-run -a -s '-screen 0 200x150x24' node docs/proofs/reliability-remediation/cc09/demo.mjs
```

This script imports the built daemon library and calls its public request handler. Eight concurrent capture requests use the existing serial queue. Pixels come from actual Xvfb/xwd decoding and PNG encoding; accessibility geometry and identity use a scripted/replay channel. This is not a real application's accessibility geometry or a representative production workload.

`with.txt` is the initial measured baseline, not evidence of a speedup. All six fixed counters must contain exactly eight attempts, capture bytes must be positive, and every response must contain the requested complete image. Unit regressions separately verify failed work, exact clock arithmetic, detached snapshots, bounded cardinality and queued request instrumentation. `workspace.txt.gz` and `mutations.txt.gz` contain verification results.

Metrics are cumulative for the process: milliseconds for queueWait, requestWork, captureAcquire, captureDecodeCrop and captureEncode; bytes for captureBytes. Request work includes all queued callback work. PNG bytes exclude base64 and the wire envelope. Event-loop maximum delay is measured by this demo, not retained by the daemon. No image bytes, identifiers or text are printed.

No RED speed comparison is supplied: this introduces observability, not an optimization. No budget is selected from this tiny fixture. Native load distributions, notification latency, retained native queue sizes, cancellation responsiveness and serialization/transport sizes remain explicit follow-ups in ADR-0104. Deployment must still authenticate/protect remote access and isolate desktop driver authority; element grants are not pixel or physical-input isolation.

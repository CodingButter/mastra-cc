# ADR-0104: Measure serial queue and native capture costs

Date: 2026-09-07
Status: Accepted — initial CC-09 measurement slice

## Decision

Expose `readCostMetrics()` on the daemon library, not on the wire. It returns detached process-wide cumulative counters for six fixed phases. Each entry has count, total and maximum. Queue wait starts when work enters the existing serial chain and ends when that work begins. Request work measures settlement of the queued callback, including authority and audit work inside that callback; it is not pure backend execution time. Capture acquisition, decode/crop and PNG encoding are measured separately. Durations use the local monotonic performance clock, including failed work. Capture bytes count encoded PNG bytes, including oversized encodings subsequently refused, not base64 or transport-envelope bytes.

Counters contain only numbers keyed by constant phase names. They retain no request IDs, element IDs, application names, text, pixels, signal payloads or per-request samples. Storage cardinality is fixed; snapshots cannot mutate live counters. They aggregate all callers in one process and are not per-session attribution or access records. No remote metrics endpoint, logging, network exposure, authority change or native parallelization is added.

Phase durations are nested, not additive: capture stages are included in request work. Observation audit and response processing after the queued callback are excluded. Do not sum all phase totals to estimate end-to-end latency.

## Evidence

The runnable built-library proof issues eight concurrent capture requests through the real daemon request queue against real Xvfb/xwd pixel acquisition and PNG encoding. Accessible identity and geometry are scripted. All six phase counters contain eight samples; the proof also reports total wall time and observed event-loop maximum delay. These are initial fixture measurements, not a latency SLA, production percentile estimate or improvement claim. Native application workloads and larger displays remain necessary before selecting budgets.

## Deployment boundary

Element grants do not isolate visible screen pixels or physical input from overlapping applications. Run one authorized daemon/driver authority per target desktop; separate processes do not share the in-process driver lock. Remote deployment must supply authentication, transport protection and appropriate OS/socket permissions. A request timeout or closed connection does not cancel already-issued effects. This measurement change does not widen network exposure or weaken those boundaries.

## Follow-ups

Measure event-to-notification latency at actual source and sink boundaries, retained native queue/backstop sizes, response serialization/base64/wire size, cancellation responsiveness, warm/cold large-display distributions and observer overhead. Whole-task control, takeover, capture freshness/provenance and Mousepad visual acceptance remain deferred. No cancellation guarantee, representative-load result or complete CC-09 instrumentation claim follows from this initial baseline.

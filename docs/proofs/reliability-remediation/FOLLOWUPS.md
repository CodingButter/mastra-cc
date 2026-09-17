# Remediation follow-ups (CC-01–CC-09)

Companion to [`AUDIT.md`](AUDIT.md). Each row is a plan sub-requirement that is
not closed by a retained proof. Disposition is one of **human-only** (blocked on
a person) or **autonomous** (could be done without one; not yet done). Nothing
in this file is claimed as implemented.

| Item | Sub-requirement | Disposition | Why |
| --- | --- | --- | --- |
| Mousepad | Human approval of the 32-step fetch-retry and original 24-step batches (both GREEN t1–t3) | human-only | Approval is the human's act. |
| Mousepad / semantic Open | Diagnose the modal-dialog `DoAction` timeout at the native bridge | human-only | Rebuilding at-spi2-core needs `libxml2-dev` (root). Peer-routing workaround rejected: failed readback 3/3, reverted (`semantic-open/` on the Mousepad branch). |
| Mousepad / visual review | Gemini video inspection | human-only | `GOOGLE_API_KEY` absent on this host. Frame-sampled Anthropic inspection was used and disclosed. |
| CC-01 | Live foreground preparation, occlusion and changed-layout characterization | autonomous | Needs a scripted multi-window Xvfb scenario; not built. |
| CC-02 | IME / autocomplete / selection on a real user desk; human-takeover-safe focus restoration | human-only | Requires a person's live desktop and input method. |
| CC-02 | Adapter-level uncertain-attempt / no-duplicate retry proof | autonomous | Scripted-channel test not written. |
| CC-04 | Immediate unsubscribe cleanup and no post-removal wake under the real framework | autonomous | Provider-local tests exist; framework-integrated run not done. |
| CC-05 | Explicit human revoke / resume and takeover checkpoints | human-only | The revoke is a human act; needs a person to exercise. |
| CC-05 | Complete-task serialization on a shared connection | autonomous | Design open: one connection, many tasks. |
| CC-06 | Unknown-origin task-state accounting; idle-wake replacement policy with a no-self-loop test | autonomous | Not designed. |
| CC-07 | Normalized crop provenance, finite/bounds validation, capture freshness | autonomous | Plan permits the current conservative refusal as interim. |
| CC-08 | Root-level degraded-watch health (a versioned "coverage degraded" signal) | autonomous | Live reparenting and root removal are proven on GTK (`cc08/reparent/`); a watch whose ancestry becomes unreadable still goes quiet rather than saying so. |
| CC-09 | Daemon-side retained-queue byte sizing (subscription book buffer, watch state) | autonomous | Consumer-throttle bytes and a recorded native rhythm are done (`cc09/load/`); the daemon's own retained structures are not yet sized. |
| CC-09 | Cancellation boundaries inside single-call effects (`emitString`, chords, pointer) and the capture subprocess | autonomous | Those are single registry/subprocess calls; a boundary would need chunking or an AbortSignal plumbed into capture. |
| CC-09 | Wire-level cancel verb for an open connection | autonomous (protocol scope) | Close-is-the-request is the measured contract; a verb is an additive protocol change. |
| Infra | Arbitrary synchronous filesystem stalls, descendants escaping the owned process group, unwritable evidence filesystem | human-only | Needs stronger isolation / storage guarantees on the host. |
| Tooling | `tools/mutations.mjs` once-per-sweep missing `report.json` | closed Sep 17 | Runner now keeps vitest's stderr, retries a silent run once and prints that it did; `--only <names>` runs entries in isolation and refuses unknown names. Root cause is still unattributed: the next silent run will print the child's last words. |

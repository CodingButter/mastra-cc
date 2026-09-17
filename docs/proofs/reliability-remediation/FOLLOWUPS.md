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
| CC-06 | Transfer/takeover across one task's lifetime | closed Sep 17 | Daemon-level test: A's watch closes on disconnect, B's watch answered after A's effect settles, B's own effect narrated unattributed. Revocation is a restart by construction (`cc06/README.md`). |
| CC-07 | Capture freshness token; fractional display scaling on real pixels | autonomous | Normalized crop provenance, finite/bounds validation and adapter metadata landed (ADR-0105, `cc07/provenance/README.md`). The crop is capture-time only; nothing rejects a stale picture yet. |
| CC-08 | Live-induced degraded ancestry (a hung or unreadable ancestor on a real bus) | autonomous | The root-level health signal is done and proven on the scripted bus (`cc08/health/`); the live GTK fixture shows no spurious nudges but does not induce the degraded edge. |
| CC-09 | Daemon-side retained-queue byte sizing (subscription book buffer, watch state) | closed Sep 17 | Measured in `cc09/daemon-queue/` (socket buffer, ~124 B/event) and bounded by ADR-0106 (`cc09/stalled-consumer/`). Per-watch state beyond the socket is the 256-pointer initialization buffer and, while stalled, up to 64 held pointers. |
| CC-09 | Cancellation boundaries inside single-call effects (`emitString`, chords, pointer) and the capture subprocess | autonomous | Those are single registry/subprocess calls; a boundary would need chunking or an AbortSignal plumbed into capture. |
| CC-09 | Wire-level cancel verb for an open connection | autonomous (protocol scope) | Close-is-the-request is the measured contract; a verb is an additive protocol change. |
| Infra | Arbitrary synchronous filesystem stalls, descendants escaping the owned process group, unwritable evidence filesystem | human-only | Needs stronger isolation / storage guarantees on the host. |
| Tooling | `tools/mutations.mjs` once-per-sweep missing `report.json` | closed Sep 17 | Runner now keeps vitest's stderr, retries a silent run once and prints that it did; `--only <names>` runs entries in isolation and refuses unknown names. Root cause is still unattributed: the next silent run will print the child's last words. |
| Tooling | `tools/mutations.mjs` deleted `find` for every entry and ignored the `replace` field 28 entries carried, so those 28 had been going red as syntax errors rather than as the named mutation | resolved | Runner now substitutes `replace` when present and names each survivor. Rerunning the 28 as written exposed one true survivor, `native-labels-sorted-instead-of-related`: no test held relation order against sorting. Order test added; 263/263 caught with substitution. |
| CC-09 | Policy for a consumer that stops reading its watch events | closed Sep 17 (ADR-0106) | Past 256 KiB unsent toward one connection its watches hold the newest pointer per element (64 max) until the pipe drains; never disconnected, never replayed, `watchEnded` never held. Built-daemon proof in `cc09/stalled-consumer/`: retention flat at 262 KB across 8,000 events instead of ~1 MB. WebSocket gauge reviewed, not measured. |

# CC-09 — native event-to-storage latency (measured)

**Verdict: GREEN, bounded.** Ten real Mousepad text mutations each travelled
native change → daemon change event → `DesktopSignals` → `notify()` →
SQLite (`LibSQLStore`) with zero model or network calls (`fetchCalls: 0`).

## What was run

`native-run.py` launches the same isolated Xvfb / D-Bus / accessibility-bus /
Mousepad session used by the Mousepad proofs (`model-session.sh`) and runs
`native-driver.mjs` in the locked consumer install (Mastra core 1.63.2 runtime,
mastracode's Mastra install for `Agent`/`Mastra`/`LibSQLStore`/`Memory`).

Per sample: subscribe the document with a fresh subscription id, issue
`setElementText`, poll `listNotifications({threadId})` every 5 ms until a row
whose `attributes.subscriptionId` and `attributes.at` match the daemon event
received on the same connection exists, then read the document back.

## Numbers (polling-inclusive upper bounds, monotonic clock)

| Measure | min | median | max |
|---|---|---|---|
| `setElementText` request → row visible in SQLite | 6.2 ms | 8.0 ms | 16.2 ms |
| daemon event received → row visible in SQLite | 4.9 ms | 6.7 ms | 10.4 ms |

All ten rows: `status = pending`, `deliveryAttempts = 0` (policy forced to
`persist`; no agent wake attempted). Attribution on the wire was `self`
because the driver's own connection caused the change; the provider was
configured to deliver `self` and `unattributed`.

## What this does not claim

- Not intrinsic native-event latency: the injection timestamp is taken before
  the daemon request, and storage visibility is bounded by 5 ms polling.
- Not wake latency: nothing consumed the notification.
- Not cancellation acknowledgement: that seam still lacks an ownership contract
  (see `../native-measurement-boundary.md`).

## Artifacts

`SHA256SUMS` covers `declaration.json`, `native-result.json`, `outcome.json`,
`driver.log`, `native-events.jsonl.gz`, `session.txt.gz`. Credential-pattern scan clear.

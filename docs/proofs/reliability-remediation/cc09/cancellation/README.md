# CC-09 — cancellation ownership and acknowledgement (measured natively)

**Verdict: GREEN, bounded.** Five real Mousepad clears (1024 emitted-key
budget each) were cancelled mid-flight by closing the driver connection. Every
one stopped at the next emitted-key boundary, ownership retired within a
millisecond, a successor connection was admitted ~25–34 ms after the close,
and the daemon's count of keys it could not retract matched exactly what the
document had lost once those keys settled. Zero model or network calls.

## The contract this proves

| Question | Answer |
|---|---|
| Who owns cancellation? | The driver connection. Closing it **is** the request; there is no second verb on the wire (`daemon/src/driver.ts`). |
| What can the daemon stop? | Emission at a *supported boundary*: the point between two emitted keys where nothing is in flight. The clear loop in `daemon/src/backends/atspi/index.ts` is the daemon's only per-key emission loop and calls `boundary()` before each key. `emitString` is one atomic registry call and has no boundary inside it. |
| What can it not do? | Retract a key the registry already accepted. The plan says so (§CC-05, §CC-09); the measurement shows it. |
| How is cancellation acknowledged? | Ownership retires the moment the running effect leaves (`DriverAuthority.settled`), the daemon writes one line (`driver N settled X ms after its connection closed mid-effect`, plus `<method> stopped at a supported boundary after E of T emissions`), and — the only externally observable form — a successor's first effect is refused with *another driver* until then and admitted after. |
| What is marked uncertain? | The emitted-but-not-yet-landed keys. `keysStillLandingAtAdmission` below is that window, measured. |

## What was run

`cancel-run.py` stages a shadow root so the shared `model-session.sh`
(Xvfb / D-Bus / accessibility bus / Mousepad) runs **this** worktree's freshly
built daemon (`declaration.json` records its SHA-256; it matches
`daemon/dist/main.mjs` at commit time). The consumer `node_modules` were
assembled from this worktree's built `@mastra-cc/*` packages plus the shared
third-party dependencies, because the previously installed consumer was built
against the other branch's schema digest and the daemon refused it at connect.

Per sample (`cancel-driver.mjs`): fill the document to 1024 characters over a
throwaway connection; open a driver connection; issue `clearElementText`; after
120 ms close the driver; open a successor and issue `revealElement` in a tight
loop until admitted; read the document at admission and again 500 ms later.

## Numbers (monotonic clock, driver side unless stated)

| Measure | min | median | max |
|---|---|---|---|
| close requested → successor admitted (polling-inclusive) | 24.9 ms | 28.2 ms | 34.4 ms |
| daemon: close observed → ownership retired | 0.2 ms | — | 0.8 ms |
| keys emitted before the stop (of 1024) | 254 | 375 | 422 |
| keys still landing at admission (emitted − observed lost) | 0 | 58 | 133 |
| emitted − lost once settled | 0 | 0 | 0 |

Refusals before admission: 0 in all five samples — by the time the successor's
first request arrived (~25 ms after the close), ownership had already retired.
The daemon's boundary-stop count equalled the settled loss in every sample.

The ~25 ms is dominated by the successor's own connect-and-hello, not by the
daemon: the daemon's own settle line is sub-millisecond. The 0–133 key landing
lag is the registry accepting `GenerateKeyboardEvent` calls faster than
Mousepad consumes them; it is why "acknowledged" and "the desk has stopped
changing" are different moments and why the plan demands fresh observation
before anyone resumes.

## Regression and mutation coverage

`daemon/src/__tests__/cancellation-is-acknowledged-at-a-boundary.test.ts`:
boundary semantics, settle-at-leave ordering, the real `AtspiBackend` clear
loop over a scripted registry stopping after exactly four of twelve keys, and
a served two-connection scenario (stop at boundary, successor refused then
admitted, acknowledgement logged, no "failed in the backend" line).

`tools/mutations.json` gained five mutations (boundary call removed, boundary
never throws, disconnect forgets to abort, ownership retires while running,
request runs outside its signal); all five are caught.

## Not claimed

- Cancellation of anything other than the per-key clear loop: `typeText`'s
  `emitString` and pointer/chord effects are single registry calls with no
  interior boundary. A cancel arriving during one of them is acknowledged when
  it returns.
- A wire-level cancel verb for an *open* connection. The plan's one-driver
  model makes close the request; adding a verb would be protocol scope.
- Timing on any desk other than this Xvfb session.

## Artifacts

`declaration.json`, `cancel-result.json`, `cancel-events.jsonl.gz`,
`daemon-acknowledgements.log` (the ten daemon lines), `driver.log`,
`session.txt.gz`, `outcome.json` (exit 0), `SHA256SUMS`.

# CC-06: kept for the task, not looped on

The first CC-06 slice (`../README.md`) made native changes honest - the
daemon says `unattributed` when it has no causal witness, and the provider
does not wake on that by default. It left two things open, both named in the
plan's acceptance: an unknown-origin change must not disappear from the
session's state accounting, and any replacement wake policy must be shown
not to build a self-triggering action/wake loop.

## What changed

- **`ObservationLedger`** (`packages/desktop/src/observations.ts`), one per
  `MastraCC`, reachable as `desk.observations`. Every change pointer the
  connection receives is recorded - `self`, `external`, `unattributed` alike,
  independently of whether it woke anyone. `stale(id)`, `observed(id)`,
  `entry(id)` and `awaitChange(id, {signal})` are the task's view: "did this
  change since I looked", and "tell me when it does". No content crosses
  (ADR-0056); looking is still a tool call through the visibility gate.
  Bounded (1024 entries, oldest evicted).
- **Quiet window after own effect.** The desk's tools stamp the ledger
  before dispatching any effect method (`EFFECT_METHODS`, an explicit list).
  When a caller opts into `deliver: [..., "unattributed"]`, an unattributed
  pointer arriving within `DEFAULT_QUIET_AFTER_EFFECT_MS` (1500 ms) of this
  session's last effect is recorded and not woken on. This is not a claim that
  it was the echo - the daemon already said it cannot tell - only that waking
  on it is indistinguishable from waking on one's own edit, which is the loop.
  `external` and `self` are never quieted here; the daemon decided those.

## The proof (`demo.mjs`, built artifacts, `with.txt`)

An agent that edits the watched element on every wake, on a desk whose
`setElementText` echoes an unattributed change 20 ms later, receives one
change from outside:

| provider | wakes | edits | echo in ledger |
|---|---|---|---|
| desk's provider (quiet window) | **1** | 1 | yes |
| bare `DesktopSignals`, same `deliver` (before this change) | **13** (cap 12 + 1) | 12 | yes |

The RED side is the second row, run in the same process against the same
build; no baseline checkout is needed to see the loop.

Unit and real-daemon tests:
`packages/desktop/src/__tests__/an-unknown-change-is-kept-and-not-looped-on.test.ts`
(ledger semantics, window semantics, effect-method list, unattributed change
resolving a task's wait with zero wakes under the default policy, convergence
with the breaker, the measured loop without it). Mutations
`an-echo-of-our-own-effect-wakes-the-agent` (drops the window check) and
`an-unattributed-change-is-not-kept-for-the-task` (drops the ledger feed) are
caught.

## Boundaries

The window is a policy with a number in it, chosen from measured native echo
latency (cc09/native-latency, median 8 ms to storage) with headroom; a
toolkit that echoes later than 1.5 s would wake. A person's change inside the
window after the agent's own effect is also quieted - it is still in the
ledger and the task can see it, but the idle agent is not woken for it; that
is the trade the plan asked for (suppress through bounded handling, do not
pretend uncertain changes are self-caused). Driver transfer/takeover and
visibility revocation mid-task remain the existing tests' territory and are
unchanged here.

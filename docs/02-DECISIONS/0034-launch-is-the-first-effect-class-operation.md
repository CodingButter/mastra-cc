# 0034 — Launch is the first effect-class operation, and B11 arrives with it

Status: accepted, 2026-08-10 (M2.1)

## Context

M1 shipped a daemon that serves exactly two methods, both observe-class, and
refuses everything else by name (`daemon/src/server.ts`, the effect-class
gate). ADR-0027 decided the assistant opens applications itself, because
readability is decided once at process start (measured: 202 nodes with the
renderer flag against 2 without; GTK via `GTK_MODULES=gail:atk-bridge`) and no
launcher entry or system setting is ever edited. ADR-0029 decided the daemon
knows what it launched through a table of `(pid, /proc start time)` pairs whose
entries only its own launch call creates. M2.1 makes those two decisions
executable over the wire.

`tools/pins/README.md:30-35` names B11 — effects enforced before the call, not
after — as the only timing pin, deliberately absent in M1 because the dispatch
table had nothing non-observe to read, and requires M2 to wire it **in the same
commit as** the first effect-class operation. Result-time enforcement is
legitimate only for observe: filtering the response does not unsend the email.

One found mismatch: ADR-0008:17 claims the five operation classes are
enumerated in `protocol/schema.json` under `enums.operationClass`. Schema
1.0.0 contains no such enum — that sentence describes the pre-1.0.0 prototype
schema. The classes live in the daemon's dispatch table today.

## Decision

The schema moves to **schema version 1.1.0**, adding one method —
`openApplication` — and this ADR is the record the freeze gate demands for it.

1. **Launch is classed `activate`.** ADR-0008's definition — visible to the
   user, trivially reversible — is the closest honest fit in the frozen
   five-class vocabulary: a launched application appears on the user's screen
   and can be closed. A new class was considered and rejected as a heavier
   change for no gain.
2. **B11 is wired in this same commit.** `tools/pins/b11.mjs` reads the
   dispatch table and asserts every non-observe entry is marked
   `enforcement: "before-call"`. The pin pins the *declaration*; the
   enforcement *timing* is pinned by the ordering test in
   `daemon/src/__tests__/launch-authority.test.ts` (authority is consulted
   before capability). The pin and the test together are B11.
3. **Authority is a session-scoped operator flag**: `--permit <name>`,
   repeatable, on the daemon's own command line. A durable permission store is
   M2.3's decision; granting it here would pre-empt that design. Consistent
   with the shipped pattern elsewhere: nothing over the socket may author its
   own authority.
4. **Capability lives in a separate catalog** (`daemon/src/launch/recipes.ts`):
   name → argv + launch-time enabling environment, as data. ADR-0019: "may we"
   and "can we" are different questions answered by different parties, and
   authority is checked first, always. Capability is never probed for an
   unpermitted name, because the probe itself is an observation (ADR-0008
   rule 6).
5. **An unknown name and an unpermitted name produce byte-identical
   refusals** — one constant, one code path, one timing. **The equality
   survives; its stated reason does not.** As written here, the reason was that
   a refusal must never reveal whether an application is installed, and
   [ADR-0042](0042-existence-is-readable-content-is-not.md) overturned exactly
   that: `listApplications` now names every application this machine has. The
   refusal constant was rewritten with it. What the equality buys under the new
   rule is narrower and still worth having — *this method* is not where
   existence is answered, so probing it teaches a caller nothing, and existence
   is readable in one honest place instead of leaking a bit at a time through a
   gate never designed to answer it.
6. **A running copy the daemon does not own is refused, never killed**
   (ADR-0027: ask, never kill — the asking surface arrives with a later
   milestone). A running copy the daemon *does* own is returned as-is:
   re-opening what we already opened is idempotent, never a second spawn.
7. **Operation classes stay daemon-side in this segment.** The ADR-0008:17
   `enums.operationClass` sentence described the prototype; wire-visible
   classes can arrive when M2.3 defines the scope surface, through the freeze
   gate like everything else.

## Consequences

- The dispatch table now carries an enforcement marking per entry
  (`before-call` for non-observe, `at-result` for observe), and B11 goes red
  if a future effect-class entry omits it.
- The permit set dies with the daemon process. Every session starts with no
  authority; M2.3 decides what persists.
- Ownership joins to the accessibility tree by name in this segment
  (`daemon/src/launch/table.ts` records the deferral); the per-element pid
  join arrives with M2.4's attribution work.
- Two new mutations guard the seam: stripping the enforcement marking must
  turn the B11 pin test red, and removing the permit check must turn the
  authority test red.

## Evidence

- Enabling is launch-time, per process: ADR-0027 (measurements inline).
- The (pid, start time) pair and its failure modes:
  `docs/proofs/how-the-daemon-knows-what-it-launched.md`.
- Authority before capability, and why probing leaks: ADR-0019; ADR-0008
  rule 6.
- B11's same-commit requirement and timing rationale:
  `tools/pins/README.md:30-35`, `docs/05-TEST-STRATEGY.md:33`.
- The M1 gate this extends: `daemon/src/server.ts` (dispatch table and
  effect-class gate), `daemon/src/__tests__/refuses-beyond-observe.test.ts`.

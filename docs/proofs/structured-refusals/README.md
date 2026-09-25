# Structured refusals: every refusal says whose it is

Decision: [ADR-0113](../../02-DECISIONS/0113-every-refusal-says-whose-it-is.md). Schema 1.27.0.

`run.sh <worktree> <digest>` starts the daemon on the replay backend (the `gtk-dialog` fixture) and runs `probe.mjs`. The probe sends three requests: an unknown method, an unknown element id, and an effect the session holds no grant for.

- **[without.txt](without.txt)** is from master `a919bd9`. The unknown method's refusal is a top-level string, so the transport threw it as a bare `Error`. The other two refusals are also untyped strings, and none of the three says whose fault it was.
- **[with.txt](with.txt)** is from this branch. All three refusals come back in `result.refusal` as `{ class, code, message }`. The codes are `agent`/`UnknownMethod`, `agent`/`UnknownElement` and `agent`/`EffectClassGate`.

The other owners are covered in unit tests:
- `world`: `BlockedByDialog` in `cdp-refusals.test.ts`.
- `daemon`: `BackendUnreadable`, `DeadlineExceeded`, and the `Unclassified` backstop in `refusal-on-unreadable-backend.test.ts`, `cdp-refusals.test.ts` and `every-refusal-says-whose-it-is.test.ts`.

Mutations `a-refusal-forgets-whose-it-is` and `the-backstop-blames-the-caller` both go red.

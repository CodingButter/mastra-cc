# ADR-0009 — Generated code is build output, not source

**Status:** accepted
**Date:** 2026-08-08

## Context

The prototype generated three artifacts from `protocol/schema.json`: a TypeScript validator, a Python validator, and the tool API documentation. All three were committed.

The churn tells the story:

| File | Revisions |
|---|---|
| `protocol/schema.json` | 23 |
| `plugin/src/schemas.generated.ts` | 24 |
| `desktop_service/protocol_generated.py` | 23 |
| `clients/shared/src/protocol.generated.ts` | 23 |

Every protocol change produced a four-file diff of which three were mechanical. Reviewers learn quickly that three of those files are noise, and then they skim, and then the one time a generated file differs from what the generator would produce, nobody sees it.

That is not hypothetical. During live debugging on 2026-08-08 a module was hand-edited in its *vendored* copy rather than at source. It was caught, but only because a parity test happened to exist for that particular pair of files. There was no equivalent guarantee for the generated protocol bindings — nothing in CI regenerated them and compared.

There is a real argument for committing generated code: a fresh clone builds without a generation step, and diffs of the generated output make protocol changes concrete. The second half of that argument has merit. The first half is a build-system problem dressed up as a source-control decision.

## Decision

**Generated code is produced at build time and is not committed. What is committed is the generator, the schema, and golden fixtures.**

Specifically:

- `protocol/schema.json` — committed, guarded by [ADR-0002](0002-schema-freeze-is-a-ci-job.md).
- `protocol/generate.mjs` — committed, with its own test.
- `protocol/golden/` — committed. Frozen request/response fixtures that capture the *behaviour* of the contract, which is what reviewers actually need to see change.
- Generated bindings — emitted into each consumer's build output directory, `.gitignore`d.

**CI runs a determinism gate:** regenerate everything from a clean checkout and fail on any diff. This is what makes the absence of committed output safe — a generator whose output drifts between runs is caught immediately rather than being papered over by a committed snapshot.

**The tool API documentation is treated the same way.** The prototype's `docs/03-tool-api.md` was 1,111 lines generated from the schema, and it was one of the best documents in the repository precisely because it *could not* drift. Keep generating it; publish it as a build artifact; do not commit it.

## Consequences

**Good.** A protocol change becomes a one-file diff plus a fixture diff, both of which a human should read. Hand-editing generated output stops being possible, because there is no committed file to edit. Review attention goes where it matters.

**Cost.** A fresh clone must run a generation step before typechecking. This is a normal build dependency and the build system handles it; the cost is one line in the setup script — which now lives in `infra/` per [ADR-0001](0001-machine-config-lives-in-the-repo.md).

**Cost.** Anyone browsing the repository on the web cannot read the generated types without building. Mitigated by golden fixtures, which are committed and are more readable than a generated validator anyway.

**Risk.** A tool that needs the generated types at edit time (an IDE, a language server) is unhappy until the first build. Accepted: run the generator once after clone, and it is in the setup script.

## Evidence

| Claim | Source |
|---|---|
| generated-file revision counts | `git log` counts on each path |
| hand-edit to a vendored copy caught by parity test | `face-parity.test.ts:53`, 2026-08-08 02:06 |
| generated tool docs were 1,111 lines and could not drift | prototype `docs/03-tool-api.md` |
| generator and golden fixtures already existed | `scripts/generate-protocol.mjs`, `scripts/generate-protocol.test.mjs`, `protocol/golden/` |
| generator idempotency was already being checked ad hoc | reshape gate run, 2026-08-07 18:33 — "protocol generator idempotent" |

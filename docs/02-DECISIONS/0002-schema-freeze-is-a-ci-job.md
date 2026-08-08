# ADR-0002 — The protocol freeze is a CI job, not a comment

**Status:** accepted
**Date:** 2026-08-08

## Context

On day one of the prototype, at 04:03, a commit landed titled *"freeze desktop control protocol v1.0 with generated bindings and compatibility suite."* Seventy-one minutes later another commit landed titled *"fix: enforce the frozen protocol on responses."* The intent was serious and the compatibility suite was real.

The file was then modified in a further **twenty-two** commits, the last on 2026-08-04 at 10:31 (`6657915`, *"Report a browser the accessibility layer cannot read as running, not as absent"*). In total `protocol/schema.json` carries 23 non-merge modification commits across the prototype's life — the freeze itself, and twenty-two changes after it.

Not one of those changes was blocked, questioned by a tool, or required to update a fixture. The freeze was prose in a commit message and a comment in a file. Prose does not fail a build.

Worth being fair to the changes themselves: several were *good* — the browser-unreadable-versus-absent change is a genuine improvement to the contract. The problem is not that the schema changed. The problem is that changing it cost nothing, so nobody had to decide whether it should.

The cost showed up elsewhere. Every schema change dragged two generated files with it (`schemas.generated.ts`, 24 revisions; `protocol_generated.py`, 23), so protocol churn produced three-file diffs of which two were noise, and reviewers learned to skim them. A frozen contract that everyone skims is worse than an unfrozen one, because downstream code starts trusting it.

## Decision

**`protocol/schema.json` is guarded by a CI job that fails on any change unless the change is accompanied by all three of:**

1. **An accepted ADR** in `docs/02-DECISIONS/` whose front matter names the schema version being introduced.
2. **A bumped schema version** inside the file itself.
3. **Updated golden fixtures** in `protocol/golden/`, plus a compatibility test demonstrating what old clients see.

The job's implementation is deliberately dumb: it diffs `protocol/schema.json` against the merge base. If the diff is non-empty, it looks for the three artifacts above and fails with a message naming which one is missing.

**Two additional gates in the same job:**

- **Determinism.** Regenerate every binding from the schema and fail on any diff against a clean checkout. This catches a hand-edited generated file, which the prototype did suffer — a hand-edit to a vendored copy was caught only by a parity test that happened to exist.
- **Digest agreement.** The daemon socket is keyed on the schema digest, so a client built against a different schema cannot connect by accident. CI asserts that the digest the daemon computes and the digest the transport package embeds are the same value.

## Consequences

**Good.** A schema change becomes a visible, deliberate act with a paper trail. Downstream generated code stops being review noise (see [ADR-0009](0009-generated-code-is-build-output.md)). Old clients get an explicit compatibility answer instead of an implicit one.

**Cost.** Legitimate protocol evolution is slower — an ADR for a field addition feels heavy. This is the intended trade. If it becomes genuinely obstructive, the correct response is to define an *additive-only* fast path (new optional fields, no removals, no semantic changes) that requires the version bump and fixtures but not a full ADR — and to write *that* down as a superseding ADR rather than quietly stopping enforcement.

**Risk.** A guard that is annoying gets bypassed with `--no-verify` or a CI skip label. Mitigation: the job runs on the merge commit, not only on the branch, so a bypass on a branch still fails at the gate that matters.

## Evidence

| Claim | Source |
|---|---|
| freeze commit, 2026-08-01 04:03 | *"freeze desktop control protocol v1.0 with generated bindings and compatibility suite"* |
| enforcement commit 71 minutes later | *"fix: enforce the frozen protocol on responses"*, 05:14 |
| 23 non-merge modification commits to `schema.json`, 22 of them after the freeze | `git log --oneline --no-merges -- protocol/schema.json` |
| last post-freeze change | `6657915`, 2026-08-04 10:31 |
| generated-file churn | `schemas.generated.ts` 24, `protocol_generated.py` 23 revisions |
| socket keyed on schema digest | prototype daemon socket implementation, issue #73 |
| hand-edited generated copy caught by parity test | `face-parity.test.ts` failure, 2026-08-08 02:06 |

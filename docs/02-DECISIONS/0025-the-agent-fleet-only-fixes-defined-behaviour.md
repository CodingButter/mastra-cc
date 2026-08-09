# ADR-0025 — The agent fleet only fixes defined behaviour

**Status:** accepted
**Date:** 2026-08-08
**Sharpens [ADR-0015](0015-one-vertical-slice-before-parallel-agents.md) along a different axis.**

> **Naming.** "Agent factory" is used in this repository in two unrelated senses. This ADR is about the **agent fleet** — the system that dispatches agents to do work. For the *codebase* of the same name, read as a worked example of building a Mastra application, see [07-ROADMAP.md](../07-ROADMAP.md) and the study spike scheduled there. The two are kept under separate names deliberately, for the reason [01-ARCHITECTURE.md §3](../01-ARCHITECTURE.md) gives about near-identical names.

## Context

[ADR-0015](0015-one-vertical-slice-before-parallel-agents.md) answers *when* parallel agents may run: after one author has settled the shape, because rework was the constraint and never throughput. It does not answer *what they may be given*, and the prototype's damage came substantially from the second question.

Jamie's direction, 2026-08-08:

> The fleet is deferred until we are strictly addressing issues. We need a great foundation with dependable tests, solid rules, and quality control in place. It isn't for features. It's specifically for handling issues or bugs — things that are clearly not the intended behaviour. **If there is no intended behaviour yet, the fleet doesn't get to create it.**

The reason this works is worth stating precisely, because it is not really about features versus bugs. **It is about whether the work has an oracle.**

| | Bug | Feature |
|---|---|---|
| Intended behaviour | already exists, written down | is the deliverable |
| Definition of done | a test goes red, then green | a judgement held by the author |
| Can the agent check itself? | yes, without asking anyone | no |
| Failure mode | the fix is wrong and a test says so | something plausible ships and nobody notices for three merges |

An agent given work with a machine-checkable definition of done can verify its own success. An agent given work without one produces something that looks right, and the cost surfaces later as rework — which is precisely the constraint [ADR-0015](0015-one-vertical-slice-before-parallel-agents.md) identified. The prototype's own numbers are the receipt: 106 of 332 commits are merges, PR #136 exists solely to repair `main`, and PR #221 and PR #228 both correctly diagnosed the same root cause and collided structurally because two agents were designing at once.

The corollary is that this ADR's precondition is not a date and not a milestone number. **It is the trustworthiness of the oracle.** A fleet dispatched against a weak test suite is worse than no fleet: it produces confident green output over work nobody checked. That also settles the scheduling question left open in [07-ROADMAP.md](../07-ROADMAP.md) — whether to pin the fleet's release before or after M1. The pin is a prerequisite of *using* the fleet, and using it is gated on the suite, not on the calendar.

## Decision

1. **The fleet is dispatched only against work with a machine-checkable definition of done.** In practice that means defects: behaviour that demonstrably contradicts documented intent.
2. **Every dispatched item carries its oracle** — the failing test, or the artifact that refuses to produce, or the gate that goes red. An item that cannot name how it will be known to be fixed is not dispatchable, no matter how well described.
3. **The fleet does not define behaviour.** If intended behaviour does not exist yet, creating it is an author's job. A dispatch that would require the agent to decide what the product should do is refused at dispatch time.
4. **Entry conditions, all of them, before any dispatch:** M6 has passed ([ADR-0015](0015-one-vertical-slice-before-parallel-agents.md)); the boundary and mutation suites in [05-TEST-STRATEGY.md](../05-TEST-STRATEGY.md) exist and have been proved by failing; the fleet release is pinned with the reason recorded in `infra/` ([06-OPERATIONS.md](../06-OPERATIONS.md)); the board is clean before dispatch, never after.
5. **The gate is the suite, not the schedule.** If the tests are not trustworthy, the fleet does not run — regardless of which milestone is complete.
6. **A refused dispatch is reported like any other refusal**, naming which condition failed ([ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) rule 4).

## Consequences

**Good.** It removes the failure mode that produced most of the prototype's rework: several agents designing simultaneously against a shape nobody had settled.

**Good.** It gives dispatch a single test that is easy to apply and hard to argue with — *what goes green when this is done?* Work that cannot answer stays with an author.

**Good.** It converts an open scheduling question into a resolved dependency. The fleet is gated on quality infrastructure, which is being built anyway.

**Cost.** Throughput is deliberately left on the table for a long time. Accepted, and it is the whole thesis of [ADR-0015](0015-one-vertical-slice-before-parallel-agents.md): 332 commits in seven days was never the shortage.

**Cost.** The bug/feature line is not always crisp. A defect whose fix requires deciding what the behaviour should be is a feature wearing a bug report, and it will be mis-dispatched at least once. The rule-2 requirement is the detector: if the item cannot name its oracle, the line has been crossed.

**Cost.** Requiring an oracle per item is real work for the author writing the issue, and it will feel like overhead on obvious bugs. It is also the only thing that makes the dispatch decision mechanical rather than a judgement call at three in the morning.

## Evidence

| Claim | Source |
|---|---|
| the fleet is for defects only; no intended behaviour means no dispatch | Jamie, 2026-08-08, rebuild design conversation |
| rework, not throughput, was the constraint | [ADR-0015](0015-one-vertical-slice-before-parallel-agents.md); [03-LESSONS.md](../03-LESSONS.md) |
| 106 of 332 commits are merges; PR #136 repairs `main` | prototype `git log`; [03-LESSONS.md](../03-LESSONS.md) §5 |
| PR #221 and PR #228 collided on the same root cause | [03-LESSONS.md](../03-LESSONS.md) §5 |
| dispatch before board cleanup produced six agents on merged PRs | [03-LESSONS.md](../03-LESSONS.md) §5; 2026-08-07 17:56–18:13 |
| a row marked `sent` means delivered, not done | [03-LESSONS.md](../03-LESSONS.md) §7 |
| pins live in `infra/` with the reason recorded | [06-OPERATIONS.md](../06-OPERATIONS.md); [ADR-0001](0001-machine-config-lives-in-the-repo.md) |
| fleet release pinning was the last open scheduling question | [07-ROADMAP.md](../07-ROADMAP.md) "Decisions taken" |
| a refusal names the check that produced it | [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) rule 4 |

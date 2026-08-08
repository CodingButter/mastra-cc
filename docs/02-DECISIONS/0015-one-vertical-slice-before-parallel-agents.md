# ADR-0015 — One vertical slice by one author before any parallel agents

**Status:** accepted
**Date:** 2026-08-08

## Context

The prototype ran a factory of parallel coding agents — as many as nineteen at once — against a codebase whose architecture was still being discovered. It produced 332 commits and 127 pull requests in seven days. It also produced, on a single night, six agents independently working on issues whose pull requests had *already merged*, three "in review" cards for work that had shipped, and one agent on its twelfth identical kickoff.

The throughput was never the problem. Two structural problems were.

**Problem one: parallel agents against an unstable architecture multiply rework.** When the shape of the system is still moving, every branch encodes an assumption about it, and the branches that merge later pay for the assumptions that changed. The day-seven reshape is the clearest case — 135 renames landing under five agents mid-turn — but the pattern is everywhere. Two separate pull requests, #221 and #228, independently diagnosed the same root cause about the widget window; one worked around it with a demo mode and the other fixed it outright, and merging them required hand-reconciling a genuine semantic conflict between two correct designs. That is a coordination cost that no amount of agent quality removes.

**Problem two: the merge tax is invisible until it isn't.** 106 of 332 commits are merges. Several pull requests exist only to repair a main branch broken by two independently-clean merges — *"Fix the typecheck main lost between two clean merges"* (PR #136) is the honest title. Nobody chose to spend that time.

The counter-evidence deserves stating: parallel agents worked *well* once the architecture stabilised. On the final night, six agents woken onto already-shipped work correctly read their own state and self-terminated without intervention, and one rebased itself before opening a pull request with the observation that *a PR mergeable an hour ago is a claim, not a fact*. Agents are good. They are good at executing against a settled shape.

## Decision

**No parallel agents until one vertical slice works end to end, written by one author.**

The slice is the north star sentence: wake → gate → hub → daemon → one semantic action → spoken answer. Nothing else. Not the dashboard beyond what enrolment requires, not a second provider, not a phone client, not the orb's visual design.

**The three phases and their entry conditions:**

| Phase | Entry condition | Who works |
|---|---|---|
| **Skeleton** | ADRs accepted | one author |
| **Vertical slice** | layout, CI, protocol gate all green on an empty tree | one author |
| **Parallel** | the slice runs on a real desktop and its proof artifacts exist | many agents |

**Rules for the parallel phase, all derived from what went wrong:**

1. **Clean the board, then dispatch.** The prototype dispatched nineteen issues about three minutes before cleaning up stale cards, and spent the next hour explaining redundant work to itself.
2. **An issue names its dependencies.** A stacked issue says what it stacks on.
3. **Pin the agent-platform version.** Every `@mastra/factory` bump silently dropped four local patches. Pinning to a known-good release is a precondition, not a preference.
4. **A queue entry that has been delivered is not a queue entry that is done.** The prototype's re-dispatch loop existed because `sent` was read as terminal. See [06-OPERATIONS.md](../06-OPERATIONS.md).
5. **Read the API's parser before guessing its payload.** Hours were lost sending a board value the parser did not accept; two issues sat blocked for twelve kickoffs on what was diagnosed as "a human must promote this" and was in fact a wrong enum string.

## Consequences

**Good.** The architecture gets settled by one mind holding the whole thing, which is the cheapest way to settle an architecture. When agents arrive, they arrive to a shape with boundaries, tests, and a working reference path — which is the condition under which the prototype's agents were genuinely excellent.

**Cost.** The first phase is slower in wall-clock terms and looks less impressive. There is no board full of moving cards. This is the trade being made deliberately: rework was the constraint, not throughput.

**Risk.** "One vertical slice" can expand. Mitigation: the slice is defined by a single sentence and a proof artifact. If a change is not on the path from wake to spoken answer, it is not in the slice.

## Evidence

| Claim | Source |
|---|---|
| 332 commits, 127 PRs, seven days | `git rev-list --count`; `gh pr list --state all` |
| 106 merge commits | `git rev-list --merges --count` |
| nineteen agents live at once | fleet liveness probe, 2026-08-07 |
| six agents working on already-merged issues | board and thread audit, 2026-08-07 18:11 |
| one item on its twelfth identical kickoff | issue #189 agent log, 2026-08-07 22:30 |
| main broken by two independently-clean merges | PR #136 |
| #221 and #228 diagnosed the same root cause differently | PR #228 merge conflict resolution, 2026-08-07 21:04 |
| reshape landed under five in-flight branches | branch probe, 2026-08-07 18:27 |
| agents self-terminated correctly on already-shipped work | thread audit, 2026-08-07 18:13 |
| "a PR mergeable an hour ago is a claim, not a fact" | issue #222 agent log |
| factory bumps silently drop local patches | `pnpm-workspace.yaml` patched dependencies; observed across bumps |
| wrong board enum blocked two issues for twelve kickoffs | transition API `parseTransitionBody`; boards are `work` and `review` |

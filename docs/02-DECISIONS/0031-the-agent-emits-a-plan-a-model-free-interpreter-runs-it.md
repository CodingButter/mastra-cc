# 0031 — The agent emits a plan; a model-free interpreter runs it

**Status:** accepted, 2026-08-09.
**Forced by:** the measurements in
[what a plan can say without a model](../proofs/what-a-plan-can-say-without-a-model.md)
and [does the second run cost less](../proofs/does-the-second-run-cost-less.md), closing
Q10 and Group G in [09-QUESTIONS.md](../09-QUESTIONS.md).

## Context

The obvious design has the agent act directly: it decides, it calls a verb, it looks at the
result, it decides again. It works, and it makes three things impossible.

There is nothing to review before it happens — a reviewer, human or otherwise, can only
watch. There is nothing to replay — the run leaves a transcript, not an artifact. And
there is nothing to measure improvement against, because "the second run is cheaper" needs
a first run that produced something reusable.

The alternative separates authoring from executing. The agent emits a **plan** — a
structured graph of steps, each with a predicate to resolve, a verb, an effect class, and
what it waits for. A **non-model interpreter** executes it: resolving, invoking, waiting,
recording. Between them, a plan can be read, modified, or refused with a stated reason.

The representation already existed. `@mastra/core` (Apache-2.0, installable from the
registry with no monorepo build) provides storable workflow graphs with serialisation,
rehydration, validation, and workflow-level metadata that survives a round trip — which is
where a plan's element list and required scopes ride.

## Decision

**The agent authors plans. A plain function executes them. No model runs in the execution
path.**

1. **No model call in the interpreter, enforced mechanically.** A check with a static half
   (no route to a model exists in the source) and a dynamic half (no outbound call occurs
   during a run) fails the build otherwise. The dynamic half covers executed paths only —
   unreached code is the static half's job, and the check says so rather than implying more
   coverage than it has.
2. **A precondition is a predicate or it does not exist.** `{role, name, within}`, which a
   daemon answers yes or no to. Passing a sentence throws. *If a plan step requires a
   language model to execute it, the plan was underspecified* — anything that has to be
   explained to a model was never captured, and the workflow learned nothing.
3. **Effects are observed, never asserted.** The interpreter diffs the surface before and
   after each step and records `observedEffects` separately from `intendedEffects`. A plan
   claiming an effect it did not cause is visible only because the two lists are kept apart.
4. **Record-and-refuse mode** runs the interpreter with effects gated off, emitting the
   complete intended-effect list while causing nothing. Its value is not consent preview —
   it must work with gating switched entirely off. It **derives the permission manifest by
   running**, so the manifest is a record rather than a claim, and it lets a stored workflow
   be tested against a changed interface with no consequences.

   It reports honestly where it stopped. A step behind a refused materialising effect is
   genuinely unreachable — a refused click never reveals what the click would have revealed
   — so the dry run agrees with the live run **up to the first effect** and says where it
   truncated rather than pretending to complete.
5. **Locators are a durability ladder** — meaning, then relation, then position, then a
   literal identifier as a tiebreaker only. Element identity is not stable across launches,
   so a stored plan holds re-resolvable predicates and never an address.
6. **Ambiguity halts the ladder; it never descends it.** Finding nothing means the address
   moved, so a weaker rung is a fair way to look again. Finding two means identity is
   unclear, and a weaker rung cannot clarify it — only disguise the guess. The run refuses
   and names every candidate with enough context to ask a natural question.
7. **A run suspends at the moment of uncertainty and resumes on the answer**, carrying its
   resolved state. Questions are not batched up front and not discovered afterwards. What
   the resumed run must re-derive is recorded, because it is a cost paid on every question
   the assistant asks.

## Consequences

**The cost.** Authoring a plan is more expensive than acting directly — the agent must
express what it intends before it learns what the interface looks like, and content that
does not exist yet cannot be planned against. That shows up in the measurement as a cold
run costing 9 steps against a warm run's 6: the second look is the expensive part.

Every capability must be a verb in the vocabulary. The prototype's action list had no
scroll, which made discovery-by-scrolling look like a missing *capability* when it was a
missing *verb*. Adding one is cheap; noticing the gap is not.

**What this buys, and why it is the reason the design survives rather than safety.** A plan
is an artifact: reviewable before it runs, replayable after, and diffable when the
interface changes. That is what makes improvement measurable at all. The dry run derives
the manifest instead of trusting a declaration. And the model-free execution path means a
replay costs nothing in tokens — which is also the trap: a warm run reporting zero tokens
is a model *absent*, not a model being cheaper, and any table saying otherwise is lying.

**The rung that had to be fixed.** The position rung slices an index, so it always returns
exactly one candidate — never ambiguous, never refused, always "successful". It selected
the wrong element after an interface change and wrote it back as a repair. That is what
clause 6 exists to prevent, and it was caught by rung telemetry rather than by the results
table, which would have shown a flattering number.

## Evidence

- [what a plan can say without a model](../proofs/what-a-plan-can-say-without-a-model.md)
  — 11 property tests: dry run emits the full intended-effect list and causes nothing;
  reports where it truncated; agrees with the live run up to the first effect; the manifest
  is derived by running; an ambiguous predicate returns every candidate and causes no
  effect; a run suspends and resumes; effects come from the surface, not the plan; a
  no-match predicate fails loudly instead of skipping.
- The no-model check, proven to **fail** when a model is introduced and to pass when it is
  removed. A check that has never failed is a wish.
- G5's answer is **go**: every precondition in the mail scenario is expressible as a
  predicate; none required prose. Measured against a fixture of the scenario's shape, not
  live Gmail — the scope of that claim is stated in the artifact and in Q03.
- G4: a virtualised row invisible to every route before scrolling, found after, with
  `scroll` as an ordinary step of class `reveal`.
- [does the second run cost less](../proofs/does-the-second-run-cost-less.md) — steps 9.0
  cold against 6.0 warm with zero spread; recovery to baseline one run after the interface
  changed. Tokens are reported as a delta and explicitly **not** claimed: the cold spread
  is larger than the cold-to-warm difference, so the mean flatters at this sample size.
- The same artifact separates the two learning substrates. A stored workflow learns *how
  to do the thing*; memory learns *who the user means*. A remembered answer that no longer
  resolves uniquely causes a re-ask — a stale locator fails to find something, while a
  stale memory confidently finds the wrong thing.

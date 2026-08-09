# Does the second run cost less

Produced by `spikes/exec/measure.mjs`, which is deleted at the end of M0.5.
3 repetitions per run. Every cell is **mean (min–max)**.

The task is given in plain language — "read the subject of my most recent email" — and an agent must author the
plan. The interpreter that executes it contains no model, in either run. So what
is being measured is a **planning** saving, not a faster click.

| run | steps | tokens | wall-clock (ms) |
|---|---|---|---|
| cold | 9.0 (9–9) | 2149.0 (889–3416) | 4799.7 (4707–4882) |
| warm | 6.0 (6–6) | 0.0 (0–0) | 2035.3 (2030–2038) |
| mutated | 8.0 (8–8) | 371.0 (364–385) | 3137.7 (2976–3349) |
| recovery | 6.0 (6–6) | 0.0 (0–0) | 2038.3 (2035–2041) |

- **cold** — no stored workflow. The agent looks, causes the list to appear, and
  has to look again, because content that does not exist yet cannot be planned
  against. That second look is the expensive part.
- **warm** — the stored workflow's predicates are re-resolved. No model is
  consulted, so the token count is not the model being cheaper; it is the model
  being **absent**. That distinction matters and is easy to overstate.
- **mutated** — the entry point was renamed, so the stored rung-1 locator
  (role plus name) no longer matches.
- **recovery** — run again with the rename still in place.

## Verdict

**SUPPORTED — the second run is cheaper, and cost returns to baseline one run after the interface changed.**

Steps: cold 9.0 (9–9) versus warm 6.0 (6–6), a difference of
3.0 against a between-repetition spread of 0.
The difference is larger than the noise, so the comparison carries.

**The token column is noisier than the steps column, and it must not borrow the
steps column's confidence.** Cold tokens spread 2527 across 3
repetitions against a cold-to-warm difference of 2149 — the spread is LARGER than the difference, so the token saving is not established at this sample size, however large the mean looks. The model's reply length varies run to run even at temperature zero; steps do
not. This is why steps-to-completion is the pass/fail measure and tokens are a
reported delta rather than a claim.

## Which rung matched, and what was repaired

- run 1: 1=meaning
- run 2: 1=**no rung matched**
- run 3: 1=meaning
- run 4: 1=meaning
- run 5: 1=**no rung matched**
- run 6: 1=meaning
- run 7: 1=meaning
- run 8: 1=**no rung matched**
- run 9: 1=meaning

Repairs written back: `1 (re-planned)`

The write-back is the part that makes the curve recover rather than flatten. A
run that finds its target at a lower rung and does **not** re-derive the rung-1
locator pays the same penalty forever, and the second run after a change looks
exactly like the first.

## The two learning substrates, kept apart

A stored workflow and a memory both make the second run cheaper, and a single
number cannot say which one is working. They are measured separately, and the
memory half is measured deterministically so that model sampling noise does not
leak into the one column that is unambiguous.

| condition | asked the user? | outcome |
|---|---|---|
| remembered, still unique | **no** | reused `Jessica Baily` |
| memory cleared | **yes** | nothing remembered |
| a second person with the same name appears | **yes** | the remembered answer now matches 2 things |

The third row is the one that matters. A stored locator goes stale when the
interface changes: it fails by not finding something, which is loud. A
remembered answer goes stale when the **world** changes, and it fails by finding
the *wrong* something, which is silent. Reusing a remembered answer that now
matches two people would be the worst failure available to this design — it is
confidently wrong and leaves no trace of having guessed.

So the rule already adopted for locators applies to memory as well: when a
remembered answer no longer resolves uniquely, **re-ask**. Never reuse it, and
never quietly prefer the newer one.

## G2 — does the wait fire for content that did not exist before the click?

**Yes, and it is load-bearing rather than incidental.** Every run in the table
above contains a step that clicks an entry point and then waits for a message
list that does not exist in any tree until that click happens. If the wait
failed, the step would throw, the run would not complete, and this harness would
refuse to write a table at all. The table exists, so the materialisation wait
fired on all 12 runs.

That is a polling wait. The push version was measured separately in
[can we subscribe to element changes](can-we-subscribe-to-element-changes.md):
a change subscription installed before page script, surviving navigation, which
observed content materialise 253ms after the click that caused it. Polling is
what this interpreter uses; push is what the daemon should offer, because a
poll cannot tell you that nothing is going to happen.

## Receipt

```
node spikes/exec/measure.mjs --runs cold,warm,mutated,recovery --reps 3
node spikes/exec/measure.mjs --runs cold --simulate-failure   # refuses: partial table
node spikes/exec/measure.mjs --runs warm --no-model           # refuses: fabricated zero
```

Model in the planning path: `deepseek-chat`, 9 calls,
3780 tokens total across the whole measurement.

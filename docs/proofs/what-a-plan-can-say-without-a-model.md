# What a plan can say without a model

Produced by `spikes/exec/run.mjs`, which is deleted at the end of M0.5.

The claim under test: an agent emits a **plan** — data — and a **non-model
interpreter** executes it. If a plan step needs a language model to be carried
out, the plan was underspecified and nothing was learned that can be replayed.

The same interpreter runs against a fixture and against a real browser; only the
surface differs. What follows is the browser run.

**The limit of this result, stated here because a number travels without its
context.** The browser was real and driven over the debugging protocol, but the
*page* was a locally authored fixture with the Gmail scenario's shape — **not
Gmail**. The live run needs an authenticated Google session, and holding the
operator's credentials is not the agent's to do; the substitution is recorded in
full in the milestone's progress record and bookmarked against Q03 in
[09-QUESTIONS.md](../09-QUESTIONS.md). What this therefore proves: the plan
representation, the interpreter, the resolution ladder and the refusal behaviour
are the real ones. What it does not prove: that a surface **I did not author**
can be addressed this way. A fixture cannot surprise its author.

Measured 2026-08-09 on Linux (Ubuntu 24.04, Wayland, Node 25.2.1, Chrome
150.0.7871.186). No measurement in this directory was taken on Windows or macOS.

## G5 — can every precondition be a predicate?

**Yes, for this scenario.** Every step's target is a `{role, name, within}`
predicate a daemon answers yes or no to. None required a sentence addressed to a
model. The plan representation refuses prose structurally: passing a string
where a predicate belongs throws, so an underspecified plan cannot be written by
accident rather than being caught in review.

| | |
|---|---|
| Subject read by the live run | `The newest subject` |
| Dry run left the page untouched | yes |
| Scopes **derived** from the dry run | `reveal` |

## The honest limit of record-and-refuse

The dry run stopped at **`locate-list`**.

This is not a defect, it is the shape of the problem: a refused click cannot
reveal what the click would have revealed, so every step downstream of a
materialising effect is unreachable in a dry run. The interpreter reports where
it stopped rather than returning a short list that looks complete.

That matters because the permission manifest is built from this list. A
truncated dry run yields a **lower bound on the scopes a plan needs, not the
full set** — so a manifest derived this way is safe to use for "has this been
approved before" and unsafe to use for "this is everything it will ever do".
Stating that plainly is the difference between a useful artifact and one that
gets quoted as a guarantee.

## G4 — scroll, and not giving up too early

| | |
|---|---|
| Row 40 findable before scrolling | **no** |
| Row 40 findable after scrolling | **yes** |
| `scroll` reachable as an ordinary plan step | yes |

**A search returning nothing does not mean the thing is absent.** Row 40 exists
throughout; it is simply not rendered, so it is in no tree of any kind until
something scrolls. This is the case the prototype handled worst, and it is not
fixed by choosing a better reading route — the earlier route comparison found
both routes equally blind to unrendered content. It is fixed by scrolling and
asking again.

Two consequences worth carrying into the design:

- **Absence is a weaker claim than it looks.** "Not found" is only honest after
  the reachable space has been exhausted, which for a scrollable container means
  scrolling it. An interpreter that reports absence on the first miss is the
  lazy behaviour the prototype was criticised for.
- **Scroll needs no special machinery.** It is an ordinary step with class
  `reveal` — it rearranges what is visible and transmits nothing — and
  discovery-by-scrolling is an ordinary loop of scroll-then-query. The
  prototype's action list had no scroll method at all, which is what made this
  look like a missing capability rather than a missing verb.

## What the run observed versus what the plan asserted (G3)

Effects are taken from a diff of the surface before and after each step, not
from the plan's declaration of what it intended. The two are recorded
separately and deliberately: a plan that claims an effect it did not cause, or
causes one it did not claim, is visible only if the two lists are kept apart.

## Receipt

```
node spikes/exec/run.mjs --dry-run
node spikes/exec/run.mjs --live
node spikes/exec/run.mjs --ambiguous-fixture   # exits non-zero: refusing is the pass
node spikes/exec/no-model-check.mjs
(cd spikes/exec && node --test)
```

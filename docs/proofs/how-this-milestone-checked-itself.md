# How this milestone checked itself

The research milestone closed on 2026-08-09. Its exit criterion was not "the work
is done" but **a cold reader can begin M1 without asking a question**. This
records how that was tested, what it found, and what the milestone knows it did
not establish.

It exists in `docs/` deliberately. The working records live in the plan's
progress file, which is not tracked by git — so for anyone who clones this
repository, they do not exist. A milestone that certifies its own exit in a file
the reader cannot see has not certified anything.

## The cold-reader test

**Mechanism.** The plan asked for a subagent that does not inherit the session,
because one that does will pass vacuously — it already knows the answers. No such
tool was available, so the stated fallback was used: a **fresh session with no
conversation history**, under a resource id that had never existed, reading a
**clean clone of the pushed commit with `.git` removed**. It saw what ships, not
a working tree. It was told to answer two questions and, if the documents did not
say, to state what was missing rather than ask.

**It asked nothing, and answered both.**

| Question | What it returned |
|---|---|
| What is M1's first commit? | The five pieces in build order, from `07-ROADMAP.md` — a two-method schema, the generator with its golden fixtures, the transport package, a Node daemon answering one method against one element, and a hub that calls it. It also listed what is out of scope. |
| What gate must that commit make *fail*? | The schema freeze gate: change one character in `schema.json` with no decision record, watch CI go red, revert, watch it go green, record **both directions**. It read the gate's mechanics out of [ADR-0002](../02-DECISIONS/0002-schema-freeze-is-a-ci-job.md) and gave the reason unprompted — the prototype's freeze was prose, and the schema changed twenty-plus times after being "frozen" with nothing ever failing. |

**It found a defect an adversarial review had missed.**
[01-ARCHITECTURE.md](../01-ARCHITECTURE.md) still specified a Python daemon on a
GLib main context — superseded by
[ADR-0030](../02-DECISIONS/0030-the-daemon-is-one-node-process.md), contradicted
by the roadmap, and never corrected. Its words: *a cold reader following §2/§3
literally would build the wrong runtime.* Fixed in `49ea100`.

That is the difference between the two checks, and the reason both exist. **The
reviewer read the documents as claims to be verified. The cold reader read them
as instructions to be followed** — and only the second reading catches a document
that is internally consistent and tells you to build the wrong thing.

It also named three genuine gaps as missing rather than guessing at them: which
backend M1 wires (deliberately an M1 decision), the freeze gate's implementation
filename, and the CI workflow path. Naming a gap instead of inventing an answer
is what makes the pass credible.

## The adversarial review

An independent reviewer inspected the documents — read-only, no shell, nothing
re-executed. It ran **four rounds**, and the count is the finding: seven must-fix
findings, then eight, then five, then seven — twenty-seven in total, and the
sequence never trended down. Every round after the first included defects created
by the previous round's fixes.

Round one: a tree measurement quoted with no artifact behind it, a speed ratio
inflated from 2.8× to 4.3×, one events measurement quoted three different ways, a
dependency's publish date relabelled as a commit date when recency was exactly
what disqualified the alternative, coverage asserted on three operating systems
from measurements taken only on Linux, and stale runtime claims in the glossary
and two decision records.

Round two: a weakness invented to argue for a decision that did not need it — the
claim that the old runtime hand-wrote what this one generates, when the
repository's own records show both ends were generated — and a table of numbers
typed from memory instead of copied from the artifact directly above it.

Round three found the two most instructive ones. An architecture diagram still
naming the old runtime, twenty lines below the line correcting it. And a
measurement asserted about a runtime that never ran it: the thread-safety abort
was measured through a C library this daemon does not load, and the record had
begun describing it as reproduced across *runtime versions* — an axis of
variation that did not exist in the experiment. **A receipt had been quietly
widened to cover the thing it was being used to justify.**

Round four found that fixing that had produced three new defects, including a
closed milestone's gate receipt edited in place to a number that gate never
produced, and a count corrected into disagreement with two other files.

**Every one of them ran in the flattering direction.** That is the pattern worth
carrying into M1, and it is not a coincidence: errors that make the work look
better are the ones nobody re-checks.

**The second pattern is that fixing is not free.** A correction is written in
confidence, at speed, by someone who has just been shown they were wrong and
wants to stop being wrong — which is exactly the state in which a receipt gets
widened or a historical record gets edited to a convenient number. Four rounds
were needed not because the first review was weak but because each round of
repairs was itself unreviewed work. **A fix is a change, and a change is
unverified until someone who did not make it looks at it.**

The most instructive was a number that was real, measured, and favourable — and
deleted anyway, because the spike that produced it is gone and no artifact
preserved it. A number without a receipt is a number without a receipt, however
much you would like to quote it.

## What this milestone did not establish

Stated here rather than only in a closed question, because these are the limits a
reader should carry into M1:

- **No live mail account was ever driven.** The plan and improvement results ran
  against a locally authored fixture with the scenario's shape, over a real
  browser. Authenticating on the operator's behalf is not the agent's to do. A
  fixture cannot surprise its author; this is M2's first live proof.
- **Every measurement here was taken on Linux.** Windows and macOS are reasoned
  about and never run. Where a document says the browser route works on all three
  operating systems, it is stating an expectation from the protocol's design, and
  says so.
- **The token half of the improvement claim is not established.** Steps to
  completion are clean and repeatable. Token spread at three repetitions is wider
  than the effect being claimed. See
  [does the second run cost less](does-the-second-run-cost-less.md).
- **The improvement measurement mutated an interface the author wrote**, so it
  demonstrates recovery from drift the author imagined.

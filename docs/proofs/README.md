# Proofs

Seventeen measurements taken during M0.5, each answering a question in
[09-QUESTIONS.md](../09-QUESTIONS.md) that could not be answered by argument.

## The convention

Every artifact names **the command that produced it**. Those commands reference paths
under `spikes/`, which **no longer exists** — the milestone's own rule was that findings
survive in documents and code does not, and the spikes were deleted at its close.

The references are kept deliberately. A measurement without the command that produced it
is a claim without a receipt, which is the exact failure this repository is built to
avoid. To recover a spike, take it from git history:

```
git log --oneline --diff-filter=D -- spikes/     # the commit that removed them
git show <commit>^:spikes/browser/coverage-count.mjs
```

Phase commits: `e355cfb` and `2b97903`, `94b9d6c`, `170ff05` (browser), `502c228` and
`26fff50`, `2db56d6`, `576b929` (daemon), `b826c9d` (execution model), `1e0ad3d`
(improvement measurement).

## What each one answers

| Artifact | Question |
|---|---|
| [which condition makes a browser readable](which-condition-makes-a-browser-readable.md) | Q01 — the flag is mandatory; nothing else flips it |
| [what the browser protocol gives us](what-the-browser-protocol-gives-us.md) | The browser substrate's shape, including per-session re-arming |
| [what a page-level recorder observes](what-a-page-level-recorder-observes.md) | G6 — 5 of 8 effect paths; instrument, never gate |
| [can we type without taking focus](can-we-type-without-taking-focus.md) | Whether input reaches an unfocused window |
| [can we subscribe to element changes](can-we-subscribe-to-element-changes.md) | G2 — push, at 253ms from cause to observation |
| [which apps the browser adapter covers](which-apps-the-browser-adapter-covers.md) | Q02 — classification without launching |
| [which route to the tree is cheaper](which-route-to-the-tree-is-cheaper.md) | The two routes head to head, same browser, same moment |
| [what hidden actually means](what-hidden-actually-means.md) | Seven ways to be invisible; 10/10 against 6/10 on "can a person see this" |
| [can Node read the accessibility tree](can-node-read-the-accessibility-tree.md) | Q07 — Node matches Python on read |
| [can Node act on the desktop](can-node-act-on-the-desktop.md) | Q07 — and on write |
| [can Node be told the desktop changed](can-node-be-told-the-desktop-changed.md) | Q07 — and on events |
| [is the accessibility binding thread-safe](is-the-accessibility-binding-thread-safe.md) | Q08 — deterministic abort, not silent corruption |
| [what language each backend wants](what-language-each-backend-wants.md) | Q07–Q09 — the ruling, per backend |
| [how the daemon knows what it launched](how-the-daemon-knows-what-it-launched.md) | Ownership, attacked three ways |
| [what a plan can say without a model](what-a-plan-can-say-without-a-model.md) | G4, G5 — go; and scroll is a verb, not a capability |
| [does the second run cost less](does-the-second-run-cost-less.md) | G1 — steps yes, tokens not at this sample size |
| [how this milestone checked itself](how-this-milestone-checked-itself.md) | The cold-reader test, the review, and what none of it established |

## Two rules these artifacts follow

**A spike that cannot exercise a condition writes nothing.** Every one refuses rather than
emitting a partial table, and the refusal was proven by making each spike fail on purpose.
The prototype specified one of these artifacts and never produced it; a half-filled table
would have been worse than the absence, because it would have been quoted.

**A number is reported with its spread, and an effect smaller than its spread is not
claimed.** [does the second run cost less](does-the-second-run-cost-less.md) reports a
token difference and explicitly declines to claim it, because the run-to-run variation is
larger than the difference.

# Which route to the tree is cheaper?

Produced by `spikes/browser/route-comparison.mjs`, which is deleted at the end
of M0.5.

Both routes are measured against **the same browser process at the same
moment**. The browser is launched with `--force-renderer-accessibility` so
that the platform route works at all; comparing a flagged browser on one route
against an unflagged browser on the other would measure the flag rather than
the route.

The page contains 120 named controls inside a scrolling container, plus one
link below the fold — because "is content that is not on screen present in the
tree" is the robustness question that actually costs something. A search that
returns nothing while the target exists is the failure mode the prototype was
worst at.

| | Platform accessibility layer | Browser protocol |
|---|---|---|
| Time to read the whole tree | **44ms** | **16ms** |
| Nodes returned | 447 | 610 |
| Named controls | 163 | 122 |
| Off-screen content present | **yes** | **yes** |

The browser protocol is **2.8× faster** on this page.

## Two things this run did NOT establish

**Robustness is not shown.** Both routes found the below-the-fold link, so the
expected difference did not appear. That is because *scrolled out of view* is
not the same as *not rendered*: Chromium omits content it has not laid out —
`display:none`, and the virtualised lists that long chat and mail interfaces
actually use — but content merely below the fold is laid out and present in
both trees. This page therefore tested the easy case. Settling the real
question needs a virtualised list, where the rows genuinely do not exist until
scrolled, and the likely answer is that **neither** route finds them and the
fix is to scroll and re-query rather than to change route. Recorded as open,
because a robustness claim resting on this run would not survive contact with
the case it is supposed to cover.

**The named-control counts disagree** (163 against
122) and the disagreement is not explained. The two routes use
different role vocabularies — `push button` against `button` — so the
filters are not counting identical sets, and the platform route may also be
reporting the same control more than once where a frame and a document both
expose it. This is exactly the kind of number that gets quoted later as though
it meant something, so it is flagged rather than averaged. It does not affect
the timing result, which is what this artifact is for.

**It does affect M1**, and that is why it stays open rather than being filed as
trivia. If a locator strategy is built against whichever count is the lower one
and the difference turns out to be real controls rather than double-counting,
the strategy cannot address up to 41 things that exist — *up to*, because the
size of the shortfall is exactly what is unestablished. The discriminating check is
cheap — compare the two sets by identity instead of by count — and belongs to
whichever milestone first resolves an element for real.

## Why the gap is structural rather than incidental

The platform route is a walk: every node is a separate call across a message
bus, and the cost grows with the size of the tree. The protocol route is one
request returning the whole tree in a single response. That is a difference in
shape, not in tuning, so it will not close with a faster machine.

It also explains a second-order effect worth naming: a walk observes a tree
that can change underneath it, so a large walk is not a snapshot. A single
response is.

## What this does not say

It does not say the platform route is unnecessary. It is the only route to
applications that are not Chromium-based, which is what the other three
adapters exist for. What it says is that where both routes are available, there
is no reason to prefer the walk.

## Receipt

```
node spikes/browser/route-comparison.mjs --port 9512
```

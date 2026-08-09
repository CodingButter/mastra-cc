# What "hidden" actually means

Produced by `spikes/browser/hidden-elements.mjs`, which is deleted at the end
of M0.5.

"Visually hidden" is not one condition. Each row is a different way an element
can fail to be visible, measured against the same browser process at the same
moment — with the accessibility flag on, so both routes are available.

| Case | In the DOM | A person can see it | Browser AX tree | Platform AX tree |
|---|---|---|---|---|
| ordinary, visible | yes | yes | yes | yes |
| `display:none` | yes | no | **no** | **no** |
| `visibility:hidden` | yes | no | **no** | **no** |
| `opacity:0` | yes | no | yes | yes |
| zero width and height | yes | no | yes | yes |
| positioned far off screen | yes | no | yes | yes |
| the screen-reader-only clip pattern | yes | no | yes | yes |
| visible, but `aria-hidden="true"` | yes | yes | **no** | **no** |
| visible, inside an `inert` container | yes | yes | **no** | **no** |
| fully covered by an opaque panel | yes | no | yes | yes |

Where the two accessibility routes agree: **10/10**.

## The finding

The accessibility tree diverges from what a human sees in **both** directions,
and both directions are deliberate.

- **Visible but not readable: 2 case(s).** An element a person can see
  is absent from the tree, because the page asked for that — `aria-hidden` and
  `inert` exist precisely to remove decorative or inactive content from
  assistive technology. An agent that reads only the accessibility tree cannot
  see something the user is looking at, and no amount of care about tree-reading
  fixes it, because the omission is the page's intent.
- **Invisible but readable: 5 case(s).** Content a person cannot see is
  present, because that too is intentional — the screen-reader-only pattern
  exists to put text in the tree and not on the screen.

## Can geometry answer it instead?

Membership in the tree does not say whether a person can see something. Bounds
might. Both routes expose geometry — the platform route through the `Component`
interface (`get_extents`, `get_alpha`, `get_layer`, and `get_accessible_at_point`,
which is a hit test), and the browser route through layout directly.

So each route was asked to decide *from its own geometry alone* whether a person
can see each element, and scored against what the layout actually says. Neither
was told the answer.

| Case | A person can see it | Browser verdict | Platform box | Platform alpha | Hit test at own centre | Platform verdict |
|---|---|---|---|---|---|---|
| ordinary, visible | yes | yes | 77×21 | 1 | self | yes |
| `display:none` | no | no | — | — | — | no |
| `visibility:hidden` | no | no | — | — | — | no |
| `opacity:0` | no | no | 121×21 | 1 | self | yes ❌ |
| zero width and height | no | no | 17×6 | 1 | self | no |
| positioned far off screen | no | no | 153×21 | 1 | self | no |
| the screen-reader-only clip pattern | no | no | 17×6 | 1 | self | no |
| visible, but `aria-hidden="true"` | yes | yes | — | — | — | no ❌ |
| visible, inside an `inert` container | yes | yes | — | — | — | no ❌ |
| fully covered by an opaque panel | no | no | 102×21 | 1 | self | yes ❌ |

**Browser route: 10/10 correct. Platform route: 6/10 correct.**

### Where the platform route's four misses come from

Each failure has a cause, and none of them is a bug in the reading:

- **`opacity:0`** — `get_alpha` returned 1 for an element the page had made
  fully transparent. The interface has the right question and the toolkit does
  not answer it.
- **`aria-hidden`** and **`inert`** — no node exists on this route at all, so
  there is nothing to measure. Geometry cannot rule on an element it never sees.
- **the covered button** — the hit test answered *self* for an element sitting
  underneath an opaque panel. The panel is not a separate accessible object, so
  from the tree's point of view nothing is on top.

That last one is the important failure. The hit test is exactly the mechanism
that should catch occlusion, and it reported the covered element as exposed.

## What this changes

**Geometry is available on both routes, so this is not a browser-only
capability**, and an earlier reading of these results overstated the asymmetry.
Extents, alpha and a hit test are the right instruments and the platform route
has all three.

**But the instruments do not return trustworthy answers there.** 6/10 against
10/10 is not a small margin, and the misses are not edge cases: a transparent
element and a covered element are ordinary interface states. The browser route
wins because it can read computed style and do a real hit test against layout,
not because it has some extra surface.

**The one structural gap stands.** `aria-hidden` and `inert` elements exist on
no accessibility route, by design. Only the document itself still holds them,
and that is browser-only.

**The practical rule for the element type**: bounds is not decoration on a search
result. It is the input to a different question — *is this the thing the user is
looking at* — and it needs the hit test beside it to mean anything, because a
covered button has a perfectly good rectangle. The prototype's element type
already carried `bounds`; what it did not carry was a hit test, and bounds alone
would have called the covered button visible.

**And the verdict must be honest about its own confidence per route.** The same
question answered from the same instruments is reliable in the browser and
unreliable on the platform. An element type that reports visibility as a plain
boolean, with no indication of which route produced it, would launder a guess
into a fact.

## How much of this is the spike's own fault

Three of these rows were wrong before they were right, and every one was a
defect in the measuring apparatus rather than in the routes:

- The ground truth itself ignored occlusion, so it called the covered button
  visible — and then scored both routes as wrong for getting it right. An oracle
  that is wrong grades everything wrong, which is the most expensive kind of
  error available here.
- The browser hit test treated an ancestor's answer as a miss, marking the
  inert-wrapped button as covered by its own wrapper.
- The platform verdict never checked whether the box was on the screen, so an
  element parked at x=-9999 passed on the strength of its width.

They are recorded because the corrected numbers are only worth as much as the
account of how they were reached.

## What this does not cover

Content that is not laid out at all — virtualised lists, where rows do not
exist until scrolled to — is a different case and is not measured here. It
remains open, and the expected remedy is to scroll and query again rather than
to change route.

## Receipt

```
node spikes/browser/hidden-elements.mjs --port 9527
```

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

Where the two accessibility routes agree: **9/9**.

## The finding

The accessibility tree diverges from what a human sees in **both** directions,
and both directions are deliberate.

- **Visible but not readable: 2 case(s).** An element a person can see
  is absent from the tree, because the page asked for that — `aria-hidden` and
  `inert` exist precisely to remove decorative or inactive content from
  assistive technology. An agent that reads only the accessibility tree cannot
  see something the user is looking at, and no amount of care about tree-reading
  fixes it, because the omission is the page's intent.
- **Invisible but readable: 4 case(s).** Content a person cannot see is
  present, because that too is intentional — the screen-reader-only pattern
  exists to put text in the tree and not on the screen.

## Why this matters more than it looks

Two consequences follow, and neither is about correctness of the reader.

**"Did the user see this?" is not answerable from the accessibility tree.** It
is a layout question, and it needs layout: geometry, computed style, and
occlusion. Any part of the design that reasons about what the human is looking
at — an approving agent judging consequence, a question phrased about something
on screen — needs a different source than the one used to find the element.

**A reader that consults only one surface is systematically wrong**, in a way
that looks like ordinary flakiness. The remedy is not to pick the better
surface; it is that the browser adapter has both the accessibility tree and the
document available over one connection, and can reconcile them. The platform
adapters, where only one surface exists, do not have that luxury — and that
asymmetry belongs in the adapter design rather than being discovered later.

## What this does not cover

Content that is not laid out at all — virtualised lists, where rows do not
exist until scrolled to — is a different case and is not measured here. It
remains open, and the expected remedy is to scroll and query again rather than
to change route.

## Receipt

```
node spikes/browser/hidden-elements.mjs --port 9522
```

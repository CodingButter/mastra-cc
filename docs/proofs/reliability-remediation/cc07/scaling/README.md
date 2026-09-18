# CC-07 under display scaling: what the pixels say

Two native runs of the same fixture on Xvfb, differing only in the display
scale the application was started under.

| Run | Scale | Picture of the panel | Verdict |
| --- | --- | --- | --- |
| `evidence/unscaled/` | `GDK_SCALE=1`, 96 dpi | 580×120, **one** colour, 100% panel | `GREEN` |
| `evidence/scaled/` | `GDK_SCALE=2`, `GDK_DPI_SCALE=1.5`, 144 dpi | 391×120, **two** colours, 51% panel | **defect, recorded** |

## Why a colour, and not a size

A capture is a rectangle read from the accessibility tree, cut out of a grab of
the visible desktop, and that only works if both numbers mean the same thing.
The toolkit lays out in logical units; the screen and the screen grab are made
of device pixels. When those disagree, nothing fails — the daemon crops a
perfectly valid rectangle out of a perfectly valid grab and returns a
confidently wrong picture. Dimensions alone cannot catch it, because the
dimensions are self-consistent.

So the fixture paints one panel a flat colour nothing else in the window uses,
with wide margins on every side. Unscaled, every one of the 69,600 pixels
returned is that blue. Scaled, 49% of the picture is window background: the
rectangle was in logical units, the grab was in device pixels, and the crop
landed partly off the element.

## What is and is not fixed

The unscaled behaviour is asserted, not merely observed — including across a
layout change, where the element grows and the re-read rectangle must grow with
it (580×120 → 580×210, still one colour). That is the regression guard.

The scaled behaviour is **recorded and not fixed**, deliberately. Correcting it
means knowing the scale factor, and the accessibility tree does not carry one:
there is no logical-screen size to compare the grabbed root against, and the
scaled rectangle is entirely in-bounds, so no bounds check can notice it either.
Every correction available from inside the daemon today would be a guess at a
ratio, and a guessed crop is the same class of error as the one being fixed —
silently plausible. The honest options both cost a design decision: cross-check
a toplevel's geometry against the X server, or have the desk declare its scale
at the protocol boundary. Recorded in `FOLLOWUPS.md` with these numbers.

## Scope

X11 through Xvfb, one GTK3 application, two scale settings. It demonstrates the
disagreement exists and is invisible without a pixel check; it does not measure
every toolkit, and Wayland-style per-output fractional scaling is not reachable
here at all.

## Rerun

```sh
# the guard
python3 run.py session.sh <consumer node_modules> <any mastra entry path>
# the defect
CC07_GDK_SCALE=2 CC07_DPI_SCALE=1.5 CC07_XFT_DPI=144 python3 run.py session.sh <consumer node_modules> <any mastra entry path>
```

Evidence under `evidence/`, hashes in `SHA256SUMS`. The capture contract itself
is [ADR-0105](../../../../02-DECISIONS/0105-a-picture-says-which-part-of-the-element-it-is.md).

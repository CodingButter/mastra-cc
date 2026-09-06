# 0088 — A picture of one element, and no more

Status: accepted; native capture mechanics superseded, first by [0092](0092-an-unproven-native-recipient-is-refused.md), now by [0093](0093-useful-native-controls-with-explicit-limits.md). The current contract is a visible root-display crop, not application-owned pixels; historical decision preserved below.
Date: 2026-09-05
Protocol change: schema version 1.19.0 (`captureElement`)

## Context

Everything this contract publishes is what a desk *says* about a thing: a name,
a role, a state, a rectangle. That is the right default, and it is why an
errand driving this desk cannot be fooled by pixels that look like a button.

It is also not always enough. Measured across the wallpaper errands of
2026-09-05: a page whose controls carry no names at all, a grid whose selection
shows only as a highlight, an image whose size is the entire point of the task
and is published nowhere. In each case the errand had exhausted what the desk
would say and had nothing left but guessing.

## Decision

A new observe-class method, `captureElement`, answers with a PNG of one named
element's rectangle, base64-encoded.

It is bounded the same way every other verb here is bounded. The caller names
an element; it never names a region. The daemon reads that element's screen
rectangle at capture time, finds the innermost mapped X window containing it,
grabs that window's pixels, and crops to the rectangle. No coordinate crosses
the wire in either direction, and an element that publishes no rectangle, or
one that is off screen, is refused rather than answered with a blank image.

Naming a window element captures that window; there is no verb for the whole
screen. Root capture fails under the compositing this desktop runs, and a
refusal that says so is better than a screenshot verb that works everywhere
except here.

The result reaches the model as an image content part, not as a base64 string
in prose.

## Consequences

- An errand can verify what it downloaded, see which grid cell is selected, and
  read a control whose only label is its shape.
- The observe class gains no new authority: a look is a look, and the same
  per-application gates apply.
- Whole-desktop capture stays absent until the compositing problem is solved,
  and the refusal points the caller at naming an element instead.

# 0091 — A window that will not part with its pixels is not the only window

Status: superseded by [0092](0092-an-unproven-native-recipient-is-refused.md); geometric fallback did not establish pixel ownership.
Date: 2026-09-05
Schema: 1.19.0 (no protocol change; the capture path in the AT-SPI backend)

Refines [0088](0088-a-picture-of-one-element-and-no-more.md).

## Context

`captureElement` finds the pixels for an element by asking the X server which
windows are showing, choosing the smallest one that contains the element's
rectangle, and grabbing that window. Innermost is the right choice: the desktop
and the panel contain everything and say nothing.

Measured 2026-09-05: an errand asked for a picture of an image on a web page and
was answered `looking at the desk failed: X Error of failed request: BadMatch
(invalid parameter attributes)`. The window the tree named as innermost is one
the server *knows about* and will not *hand pixels for* — unmapped, or redirected
away by the compositor this desk runs. Two other captures in the same run
succeeded, so the errand had every reason to think looking worked and this
particular thing was unlookable.

## Decision

The covering windows are tried innermost-first rather than innermost-only. Each
candidate contains the whole rectangle, so any of them yields the same pixels
after the crop; the loop exists because only some of them will part with any.

If every covering window refuses, the refusal says exactly that and quotes what
the last one said, rather than reporting a desk that cannot be looked at.

## Consequences

- A picture of a web page's image now works where the innermost X window is one
  the compositor has redirected.
- The fallback grabs a larger window and crops it, so a refused innermost window
  costs one extra grab and a little more decoding.
- If the outer window is partially obscured by another window, the pixels under
  the obscured part are whatever the server has — X gives no guarantee about the
  contents of an occluded region. The picture is still a picture of the screen,
  which is what the caller asked for.

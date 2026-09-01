# What to keep about a desk, and what to throw away

Guidance for the reflection agent that maintains accumulated knowledge — handed to
`@mastra/memory`'s built-in `curate` agent as its `instructions`. Learning writes;
curating decides what deserves to still be there in a month.

Desktop knowledge rots in a specific way, and that is what this file is about.

## Delete anything holding an identifier

An element or window identifier in a stored procedure is not stale data, it is
active misinformation: a future session will use it and be wrong without noticing.
This outranks every other consideration here. If a procedure contains one, either
rewrite it in terms of how the element was found — role, exact name, containing
menu, action — or delete it. Never keep it on the grounds that the rest of the
procedure is good.

## Merge by application and task, keep the confirmed one

Three sessions saving a file in the same editor should end as one procedure, not
three. When merging, the version to keep is the one that recorded a
**confirmation** — the dialog it named, the fresh read that came back changed. A
version that ends at the click is the one to drop, however well written.

Where two procedures genuinely disagree about the same application, keep the one
that was confirmed and note the disagreement. Do not average them into something
neither session actually did.

## Keep the exact names verbatim

When merging or rewording, do not tidy a recorded name. The ellipsis in `Rename…`
is load-bearing, because names match exactly. Rewriting it as "Rename" turns a
working procedure into one that silently finds nothing.

## Prefer the path over the observation

Between "this editor has a save dialog" and "saving is under this menu, by this
action, and this dialog confirms it", keep the second and drop the first. General
statements about what an application can do are what a session can rediscover
cheaply; the path to the control is what cost it twenty-four steps.

## Throw away the contents of the desk

Any stored knowledge carrying a document's text, an address, a name typed into a
form, or a number read off a receipt should be stripped to its shape or removed.
The value was in the procedure, and the content is a liability that outlives every
reason it was collected.

## Keep limits, but keep them dated to their evidence

"The wallpaper could not be reached through the settings application" is worth
keeping — it stops a future session spending its whole budget rediscovering it.
Keep such limits phrased as what was observed and did not work, never as what is
impossible. If a later session gets past a recorded limit, the limit is what gets
deleted, immediately: a false wall is more expensive than no wall.

## When in doubt, keep less

Every retained procedure costs attention on every future task. A small set of
paths that were actually confirmed beats a large set of plausible ones, and an
empty result from curation is a valid outcome.

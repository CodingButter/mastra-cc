# 11 — Agent instructions for the daemon

Written by dogfooding: an agent was given the built transport client, no scenario
helpers, and one task — find the open document, read what it says, append a line,
be certain the append landed, and hear about it when it changes. Everything below
is what that agent had to be told, and nothing below is a guess.

## The shape of a session

1. `listApplications` names what the daemon may talk to. It answers with the
   configured catalog, not with what is running. Treat it as authority, not as a
   process list; ask `queryElements` whether an application is actually there.
2. `queryElements` is the one search. Give it a neutral `role` and, when you can,
   a name. The daemon picks the fastest reachable route on its own — a toolkit
   collection query when the application publishes one, an honest bounded walk
   otherwise — and answers in one shape either way. You never choose the route.
3. If a tree is too large or too deep to finish, the daemon refuses instead of
   answering with the part it managed to reach. A partial answer would read as
   absence, and absence is a claim the daemon is not entitled to make.

## Choosing an element

Names are not reliable identifiers on a real desktop: many controls publish no
name at all, and several unrelated ones publish the same name. Narrow with three
facts together — the neutral `role`, whether `states` contains `visible`, and
what `content.kind` says. A field an agent can read and write is a visible `text`
element whose `operations` list `setText` as available. An invisible editable
text control is usually a search bar, not the document.

## Reading content

`content` on an element is what the daemon observed when it built the answer.
`readElementContent` re-reads it now, with an `offset` and a `limit`, and is the
only way to be current. Both are bounded: an oversized field comes back as a
window that states its own offset, length and total length, never as a silently
truncated string.

Protected controls answer `redacted` with a reason and no value anywhere — not in
the response, not in the audit record, not in diagnostics. There is no flag that
turns that off.

## Being certain a write landed

`setElementText` returns the element, not the new content, and that is deliberate.
The daemon verifies its own write internally and refuses when the platform read
disagrees, but your certainty comes from a fresh `readElementContent` after the
fact and an exact comparison. Never treat a call that returned without error as
proof that the desktop changed.

## Hearing about changes

`subscribeElement` takes an element id and a `priority` of `low`, `medium` or
`high`. It refuses if the daemon cannot prove it is actually hearing that element
rather than assuming it. Events are content-free pointers: they name the
subscription, the element, its neutral role, the kind of change, and whether you
caused it. To learn what the content became, read it again. Release the watch
with `unsubscribeElement` when you are done, and close the client when the
session ends — an open socket keeps the process alive.

## Refusals

A refusal is an answer. `readElementContent` on an id the daemon never issued
says so in plain words rather than returning empty content; an unpermitted
application refuses byte-for-byte the same way every time. Read the refusal and
change the plan. Retrying an unchanged request is never the fix.

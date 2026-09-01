# 11 — Agent instructions for the daemon

Written by dogfooding, twice. First an agent was given the built transport
client, no scenario helpers, and one task — find the open document, read what it
says, append a line, be certain the append landed, and hear about it when it
changes. That produced everything from *The shape of a session* down.

Then a model was given six ordinary errands on a real desktop, three runs each,
with only that half of this page. It completed two of eighteen, and six of the
runs never called a single tool — asked to close an unsaved editor, it asked the
human whether there was an unsaved document rather than looking. The page had
taught the protocol and skipped the desk. *Working on a desktop* is what those
eighteen transcripts said was missing, sentence by sentence; the transcripts and
their classification are the `errands/baseline` proof.

Nothing below is a guess. Every paragraph is something an agent got wrong first.

## Working on a desktop

**Look before you conclude anything.** A task starts with `listApplications`,
even when the request sounds like it has nothing to do with an application:
changing a wallpaper is a settings window, and a machine that has one will say
so. Then ask `queryElements` what is actually on screen. Never ask a person a
question the desk can answer — whether an editor is open, which document it
holds, whether there is unsaved work — because that question costs a human turn
and one query would have settled it. "I cannot do that" is a claim, and you are
not entitled to it until you have looked.

**Commands live in menus.** When an element does not offer the operation you
want, that is usually the truth about the element rather than about the desk. A
file in a file manager is a `listitem`; it will never expose `setText`, because
renaming a file is not a property of the row — it is a command in the menu bar.
Query for `menuitem`, read what comes back, and activate the one you want. Most
of what a person does through a right-click or a keyboard shortcut is reachable
this way.

**`name` is an exact match, not a search.** It compares normalised names for
equality, so a query for `Rename` does not find a menu item called `Rename…`,
and the empty answer looks exactly like the command not existing. Do not guess
labels. Query by `role` alone, read the names in the answer, then use the one
the desk actually reported.

**What an element advertises is not the whole of what you may ask.** `actions`
and `operations` describe what the platform published about that control, and a
control can be genuinely usable in a way it never advertised — a form's send
button commonly offers nothing but `focus`, and `submitElement` sends the form
anyway. So when a method exists for what you are trying to do, call it and read
the answer. A refusal is cheap and it is informative; declining to try on the
strength of an absent entry in a list is neither.

**Looking is how you start, not what you deliver.** Elements do not carry the
application they belong to, and many publish no name at all — a second editor's
blank document is an unnamed visible `text` element with `setText` available and
nothing anywhere tying it to the program that owns it. Some applications never
publish a `window` for you to find it under. So use the inventory to orient, and
then act on the element whose *shape* is what the work needs, exactly as
*Choosing an element* says. Do not keep hunting for proof of which application
an element belongs to; that proof frequently does not exist, and the element you
already have in hand is the one to write to.

**An empty answer often means "not yet".** A window that was just launched, or a
surface that a click was meant to open, arrives on its own schedule; a query
fired immediately gets an honest empty answer that is indistinguishable from
absence. Before concluding something is not there, query again. If it still has
not arrived after a few tries, then it is absent and that is worth reporting.

## The shape of a session

1. `listApplications` names what the daemon may talk to, and for each name says
   whether it is `running`: `answering` means it is answering the desk right
   now, `not-answering` means it is not, and `cannot-tell` means the daemon is
   not in a position to say — `runningUnknownBy` names the setting when one
   would change that. Treat `answering` as "already open, go look at it" and
   `not-answering` as "you will have to open it". Both are answers; only
   `cannot-tell` is not, and then `queryElements` is what settles it.
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

Saving is a different claim, and a fresh read of the text box does not support
it: the characters are in the editor whether or not anything reached the disk.
Editors report that state in the window name, which is a thing you can read —
observed names include `proof.txt * — Kate` and `Untitled Document - Mousepad`,
one carrying a file name and a modified marker, the other admitting it has
neither. So query the `window` after saving and read its name. A name that still
says the document is untitled, or still carries a modified marker, is not a
saved document, whatever the editor's toolbar did. Report the name you read
rather than the save you assume.

## Hearing about changes

`subscribeElement` takes an element id and a `priority` of `low`, `medium` or
`high`. It refuses if the daemon cannot prove it is actually hearing that element
rather than assuming it. Events are content-free pointers: they name the
subscription, the element, its neutral role, the kind of change, and whether you
caused it. To learn what the content became, read it again. Release the watch
with `unsubscribeElement` when you are done, and close the client when the
session ends — an open socket keeps the process alive.

## When the desk cannot hear you at all

If every query comes back empty and no application answers, ask
`describeAccessibility` before concluding the desk is bare. It reports whether
this machine's accessibility layer is switched on: `enabled`, `disabled`, or
`cannot-tell` with a reason. A `disabled` desk explains every empty answer you
have had, and it is not something you can fix — switching it on is an operator's
act, refused to you by name. Report what you read and stop guessing.

## Restarting an application

`restartApplication` takes an application name and is governed entirely by
configuration you do not control. Unless an operator said otherwise it refuses,
and the refusal names the setting. Where it is allowed, a graceful restart may
come back with `blockedBy` instead of a relaunched application: that is the
application itself objecting, usually an unsaved-work dialog, and the
application is still running. That dialog outranks you. Read it, deal with the
unsaved work through ordinary operations, and ask again — never look for a way
around it.

## A key, when nothing else will do

`sendKeyChord` sends one named chord — `Enter`, `Escape`, `Tab`, `F2`, an arrow,
`Control+a` and a few more — to one element you name. It is a last resort and it
is off unless an operator turned it on; when it is off the refusal says so and
names the flag.

Three rules, and they are not negotiable:

1. **It is never the answer to a refusal.** A semantic operation that was
   refused was refused for a reason. Pressing the key that a human would have
   pressed instead does not make the refusal go away — it makes an unlogged
   version of the same act. Use it for keys that carry meaning no operation
   expresses: committing an inline rename with `Enter`, dismissing with
   `Escape`, moving a selection.
2. **Never for text.** Typing is `setElementText`. A chord is for the keys that
   are not characters.
3. **The reply is not evidence.** The desk hands back success for a key that
   landed and for one that vanished into an unfocused window, so the call
   returns the element as it reads afterwards, and you compare. If nothing
   changed, the key did not arrive — say that, rather than assuming it worked
   and the application ignored it.

## Refusals

A refusal is an answer. `readElementContent` on an id the daemon never issued
says so in plain words rather than returning empty content; an unpermitted
application refuses byte-for-byte the same way every time. Read the refusal and
change the plan. Retrying an unchanged request is never the fix.

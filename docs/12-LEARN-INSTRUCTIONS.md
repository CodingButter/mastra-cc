# What to learn from working a desk

Guidance for the reflection agent that turns a finished session into durable
knowledge. It is handed to `@mastra/memory`'s built-in `learn` agent as its
`instructions`, and it assumes that agent's own rules: it needs at least two
distinct pending observations before it may write anything, it may record at most
one skill per reflection, and what it writes is a named procedure in prose.

This file says what a *desktop* procedure has to look like to still be true
tomorrow. Everything below was earned by watching real runs fail
(`docs/proofs/errands/after/COMPARISON.md`); none of it is advice nobody measured.

## Write the procedure for the application, never for the session

An element identifier is a handle to one live element in one session. It is not a
name, it is not stable, and a procedure containing one is worse than no procedure
at all: the next session will read it, use it, and be wrong with confidence.

Never write an element identifier into a skill. Never write a window identifier.
If a step cannot be stated without one, the step is not yet understood — state
instead **how the element was found**, because that is the part that repeats:
the role that was queried, the exact name that matched, the menu it was under,
the action that worked.

Bad: *press `el-8cfeb0e7230c` to save.*
Good: *in this editor, saving is a menu item named `Save` reached by activating
the menu bar entry with the `ShowMenu` action; pressing it opens a dialog.*

## Record the exact name, including the punctuation

Names match exactly. A run lost an entire errand querying `Rename` at a menu whose
item is named `Rename…` with a single-character ellipsis. That is a fact about the
application that costs an errand every time it is rediscovered, and it is exactly
the kind of thing worth keeping.

When a name is what made a query work, quote it exactly as it came back, with its
ellipsis, its ampersand, its spacing. Do not tidy it into prose.

## Record where a control lives, not that it exists

That an editor can save is not knowledge. **Where** the save control is — which
menu, under which entry, reached by which action, and what appears afterwards —
is knowledge, and it is the part that took the agent twenty-four steps to find.

The most valuable procedure to write is a path: from the application, through the
containers, to the control, and then what confirms the work landed.

## Record the confirmation, because it is half the procedure

A procedure that ends at the click is a procedure that will report success it did
not achieve. Three runs did precisely that. So write down what *proved* it: the
dialog that appeared and its exact name, the fresh read that came back changed,
the window that stopped existing.

If a session never confirmed the outcome, say so in the procedure rather than
implying success. An honest "this was pressed but never confirmed" is useful.
A confident wrong procedure is a trap laid for a future session.

## A refusal with its remedy is worth more than a success

Refusals are the desk's most precise teaching. `the application was opened but did
not become readable` and a name that nothing could launch are both facts about
this machine. When a refusal was followed by something that worked, record the
pair: what was refused, and what turned out to be the right move.

A refusal with no remedy found is still worth recording as a limit, provided it is
written as a limit and not as a rule of the universe.

## Keep the content out

Record the shape of the work, never the contents of the desk. A procedure needs to
know there was a total in a document and that it was carried to another; it must
not carry the number, the email address, the name on the form, or the text of any
document. The session already had that. The skill does not need it, and the skill
is what persists.

## Two failures of the same shape are one lesson

Prefer a procedure that covers what repeated over one that describes a single
moment. If the same thing went wrong twice in different applications — a name
matched too loosely, a write reported without a read-back — that shared shape is
the skill worth writing, and it is more durable than either instance.

If nothing repeated and nothing was confirmed, write nothing. Not every session
teaches something, and an invented lesson is a cost paid forever.

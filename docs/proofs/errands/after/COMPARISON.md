# What the desk taught the instructions

Six errands a person would actually ask for, three runs each, run twice: once
with the instructions as they shipped, once with the instructions this exercise
rewrote. Same desk, same model (`google/gemini-2.5-flash`, temperature 0, 24-step
budget), same fixtures, same day. Thirty-six transcripts, all committed beside
this file.

- baseline prose: `48ec9147…`, 65 lines — `baseline/E*.txt`
- literate prose: `c3584f7b…`, 132 lines — `after/E*.txt`

## The number that matters

|  | baseline | literate |
| --- | --- | --- |
| errand runs that finished the errand | **1 / 18** | **9 / 18** |
| runs that never made a single tool call | **6 / 18** | **0 / 18** |
| runs that claimed success without confirming it | 3 | 0 |

| errand | baseline | literate |
| --- | --- | --- |
| E1 save a new shopping list | 0/3 (2 claimed it anyway) | 0/3 |
| E2 rename a file in the file manager | 0/3 | 1/3 |
| E3 fill and submit a contact form | 3/3 | 3/3 |
| E4 change the wallpaper | 0/3 (**0 tool calls**) | 0/3 (looked hard, 24 steps) |
| E5 carry a total between two documents | 0/3 (1 claimed it anyway) | 2/3 |
| E6 close a dirty editor, handle the dialog | 0/3 (**0 tool calls**) | 3/3 |

E3 was already fine and stayed fine — the protocol prose was never the problem
for a form that is all fields and a submit button.

## What actually changed

**The six runs that never looked.** Asked to close an editor, the baseline agent
replied "Which editor do you want to close?" — three times out of three, without
calling anything. Asked to change the wallpaper it said it was "unable to change
desktop settings," again with zero calls, having never once looked at the desk to
find out. That is the single largest failure in the baseline and it is not a
capability gap: it is an agent guessing about a room it can see. Adding *look
before you conclude; an unopened application is not an absent one* took that
column to zero. Every literate run looks.

**E6 is the clean before-and-after.** Baseline: 0 calls, a question back. Literate:
window, menu, press Close, `role:"dialog"`, press the discard button, then a fresh
query to confirm the window is gone — 8 calls, three times out of three.

**The modals were never invisible.** The open question from the baseline was
whether Kate's confirmation dialogs reach the wire at all. They do, exactly as
`role:"dialog"`, named `Close Document — Kate` and `Save File — Kate`. They never
appeared in the baseline transcripts for the least interesting reason available:
nothing ever asked for them.

**Honesty improved along with success.** Baseline E1 pressed Save, queried the
dialog once, and then reported "I have opened Kate, written the list, and saved
it" — with no confirmation and, in fact, no save. Three baseline runs report work
they did not finish. Zero literate runs do; E1's literate runs say plainly that
they could not find the save option. Slower and truthful beats fast and wrong,
and the fresh-read-after-write rule is what bought it: literate E5 types the
total and then reads the element back before saying it is done.

## What the instructions could not fix

**E1 ran out of budget, not ideas.** Two literate runs hit the 24-step cap with
the Save dialog open in front of them. The prose made the agent thorough, and
thoroughness costs calls; it queries, confirms, re-reads. This is a real cost of
the rewrite and the transcripts show it plainly rather than hiding it.

**E4 is not a prose problem.** The literate agent opens System Settings, walks it
for 24 steps, and cannot get to a wallpaper control. No wording fixes that. It is
the honest limit of what this desk exposes, and it stays 0/3 in both columns.

**E2 is still mostly unsolved** — one run in three. The menu item is discoverable
(`Rename…`, with the ellipsis) but finishing the rename remains unreliable.

## One correction the transcripts forced on me

The first literate draft made E5 *worse* than baseline: 0/3 against 3/3. The
transcript said why. At call 3 the agent already held the empty second document —
an unnamed `text` element — and threw it away to go hunting for a window that
would prove which application owned it. My new prose had pushed identify-the-app-
first hard enough to step on the existing rule about choosing an element by its
shape. Elements do not carry their application, many publish no name, and some
applications never publish a window at all; the proof the agent went looking for
does not exist. Saying so explicitly is what turned E5 into 2/3.

## A harness bug that was pretending to be evidence

Two days of editor errands failed in ways that made no sense, and the cause was
mine. Cleanup killed the editor with `SIGKILL`, so the next launch believed it had
crashed and opened a **session chooser** instead of the document. The process was
alive, so the fixture's liveness check passed, while the document the errand talks
about was never on screen. A run whose precondition never existed reads in the
transcript exactly like the agent failing — and I nearly wrote an instruction
change out of one. Every fixture now proves it is alive *and* in the right state
(E6 checks the editor is actually dirty) and the sweep dies rather than emit a
transcript that would be misread as a result. All thirty-six runs above were
collected after that fix.

# What the desk taught the instructions

Six errands a person would actually ask for, three runs each, run twice: once
with the instructions as they shipped, once with the instructions this exercise
rewrote. Same desk, same model (`google/gemini-2.5-flash`, temperature 0, 24-step
budget), same fixtures, same day. Thirty-six transcripts, all committed beside
this file.

- baseline prose: `48ec9147…`, 65 lines — `baseline/E*.txt`
- literate prose: `c3584f7b…`, 132 lines — `after/E*.txt`

The literate prose as it ships today hashes `4e868255…` (132 lines, 7,632 bytes),
not the `c3584f7b…` stamped in those transcript headers. The difference is one
word, in the sentence of the preamble that reports this exercise's own baseline
result: *"It completed three of eighteen"* became *"two of eighteen"*, because
recounting the committed transcripts for this review found the original tally
wrong. It is a correction to a number the page reports about itself. No line of
guidance an agent acts on differs between the two hashes, so the transcripts
remain evidence for the shipped text — but the hashes are not equal and saying
they were would be the same sin this page exists to name. The six E2 transcripts
are the exception: they were re-collected after that correction and stamp the
shipped hash exactly.

## The number that matters

|  | baseline | literate |
| --- | --- | --- |
| errand runs that finished the errand | **2 / 18** | **8 / 18** |
| runs that never made a single tool call | **6 / 18** | **0 / 18** |
| runs that claimed success without confirming it | 2 | 0 |

| errand | baseline | literate |
| --- | --- | --- |
| E1 save a new shopping list | 0/3 (1 claimed it anyway) | 0/3 |
| E2 rename a file in the file manager | 0/3 | 0/3 (surface, see below) |
| E3 fill and submit a contact form | 2/3 (1 claimed it anyway) | 3/3 |
| E4 change the wallpaper | 0/3 (**0 tool calls**) | 0/3 (looked hard, 24 steps) |
| E5 carry a total between two documents | 0/3 | 2/3 |
| E6 close a dirty editor, handle the dialog | 0/3 (**0 tool calls**) | 3/3 |

E3 was nearly fine already and became reliably fine — the protocol prose was
never much of a problem for a form that is all fields and a submit button. The
one baseline miss is the same failure as everywhere else: `baseline/E3-run1.txt`
focused the *Send message* button twice with `activateElement`, never called
`submitElement`, and reported *"activated the Send message button"* as though the
form had gone. All three literate runs called `submitElement`.

## What actually changed

**The six runs that never looked.** Asked to close an editor, the baseline agent
asked which editor was meant — three times out of three, without calling
anything (`baseline/E6-run1.txt` puts it as "Which editor do you want to close?";
the other two paraphrase). Asked to change the wallpaper it answered that its
"capabilities are limited to interacting with application UI elements"
(`baseline/E4-run1.txt`), again with zero calls, having never once looked at the
desk to find out. That is the single largest failure in the baseline and it is not a
capability gap: it is an agent guessing about a room it can see. Adding *look
before you conclude; an unopened application is not an absent one* took that
column to zero. Every literate run looks.

**E6 is the clean before-and-after.** Baseline: 0 calls, a question back. Literate:
window, menu, press Close, `role:"dialog"`, press the discard button, then a fresh
query to confirm the window is gone — 8, 9 and 8 calls across the three runs.

**The modals were never invisible.** The open question from the baseline was
whether Kate's confirmation dialogs reach the wire at all. They do, exactly as
`role:"dialog"`, named `Close Document — Kate` and `Save File — Kate`. They never
appeared in the baseline transcripts for the least interesting reason available:
nothing ever asked for them.

**Honesty improved along with success.** Baseline E1 pressed Save, queried the
dialog once, and then reported "I have opened Kate, written the list, and saved
it" — with no confirmation and, in fact, no save. Two baseline runs report work
they did not finish (`baseline/E1-run3.txt` and `baseline/E3-run1.txt`). Zero literate runs do; E1's literate runs say plainly that
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

**E2 turned out to be surface, not prose.** Re-collected on a fixed fixture (see
below), it is 0/3 on both sides — but the two runs differ completely in how far
they get. The baseline stops early, 7 to 11 calls — and honesty demands the caveat that
only one of its three re-collected runs got as far as the file: the other two hit
a desk that would not answer ("the desktop could not be read by this session's
backend", and one that never found Dolphin at all). The baseline's 0/3 is
therefore not the interesting half of this row. The literate
agent spends 20 to 27, and `after/E2-run1.txt` gets all the way through: it finds
the file, activates `Rename…`, types `notes.txt` into the inline editor, and then
cannot commit it. Its own account is exact — no control offers a `Press` that
would finalise, `submitElement` is refused on the text field as ambiguous, and
"the application might be expecting a keyboard interaction, such as pressing
'Enter'". There is no key press among the fourteen methods. Better prose walked
the agent to the edge of the protocol and the protocol is where it stopped, which
is the most useful thing E2 could have told us.

## One correction the transcripts forced on me

A first literate draft regressed E5. Running that draft against the baseline
prose three times each — an E5-only diagnostic, not the sweep scored above — the
baseline finished it 3/3 and the draft 0/3. The transcript said why. At call 3 the agent already held the empty second document —
an unnamed `text` element — and threw it away to go hunting for a window that
would prove which application owned it. My new prose had pushed identify-the-app-
first hard enough to step on the existing rule about choosing an element by its
shape. Elements do not carry their application, many publish no name, and some
applications never publish a window at all; the proof the agent went looking for
does not exist. Saying so explicitly is what turned E5 into 2/3.

## A second harness bug, found in review, then fixed

E2 originally asked for `proof.txt` to be renamed to `receipt.txt` — in a
directory where the fixture reset creates a `receipt.txt`, because E5 needs a
receipt to read. The destination existed before the errand began, so the row
measured nothing: the run scored a success on an agent's report that a
`receipt.txt` was present, which was true before it started.

E2 now renames to `notes.txt`, a name the reset explicitly removes and never
creates, and every transcript ends with a listing of the working directory read
from the desk itself — so the claim is checked against the filesystem rather than
against the agent. Both sides were re-collected under that fixture, three runs
each, and every one of the six listings shows `proof.txt` still present and no
`notes.txt`: 0/3 and 0/3, on the evidence rather than on a narrative.

The scored success it removes is the reason to trust the rest. The after column
is 8/18, not the 9/18 first published here. The six re-collected E2 transcripts
also stamp the current instruction hash, which is why they alone among the
thirty-six carry `3bef2f2d…`.

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

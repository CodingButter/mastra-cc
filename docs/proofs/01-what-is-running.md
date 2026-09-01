# Is it already open? — running state, measured on a real desktop

**Produced by:** `bash infra/webtop/01-what-is-running/proof.sh`
**Date:** 2026-09-01 · **Base:** `f2cf93c` (master) · **Model:** `google/gemini-2.5-flash`
**Transcripts:** [red](01-what-is-running-without.txt) · [green](01-what-is-running-with.txt)

## The question

Issue #53: `listApplications` names what is installed and never says what is running. An agent
that cannot tell the difference has two bad moves available — open a second copy of an editor
already sitting in front of the user, or read an empty query as an application that isn't there.

## The errand

Three beats against a real KDE desktop in the Webtop container, with Kate closed and its session
state cleared first: *ask whether the editor is running* → *open it* → *ask again*. Both answers
have to come from `listApplications`; the harness reads the same field itself, out of band, so the
verdict is the daemon's two answers and the model's two answers merely have to agree with them.
A model that remembers pressing the button can say "running" without the desk telling it anything.

Each side runs the client **its own commit ships** — packed tarballs into separate scratch
projects — because this change moves the schema (1.6.1 → 1.7.0) and a client built against the new
digest is refused at the old daemon's handshake. Same grant, same permit, same errand, same model
on both sides: the only difference is the daemon.

## What happened

| | base `f2cf93c` | this branch |
|---|---|---|
| daemon, before → after the launch | `undefined` → `undefined` | `not-answering` → **`answering`** |
| model, before → after | `UNKNOWN` → `UNKNOWN` | `NOT-RUNNING` → `RUNNING` |
| tool calls | 3 | 3 |
| verdict | red (exit 1) | **green (exit 0)** |

The red side is worth reading closely, because it is not a crash. The base daemon answers
`listApplications` perfectly well; the field simply is not there, so the model — correctly, and
without being coached — says `UNKNOWN` **both times, including while Kate is open on screen in
front of it**. That is the gap issue #53 describes, reproduced as behaviour rather than asserted.

## Two things the live run caught that the unit tests could not

**1. The census keys on runtime names.** The first green attempt reported `not-answering` for an
editor that was visibly open: the accessibility bus calls the process `kate` and the inventory
entry is named `org.kde.kate`. The launch layer already owns that translation through `appearsAs`;
running-state now borrows it (`daemon/src/server.ts`, `treeNameOf`) instead of inventing a second
answer to the same question. Covered afterwards by a unit test, but no unit test was going to
notice it first — both names were fixtures the test itself chose.

**2. A vocabulary that reads as a shrug is not an answer.** The state was originally called
`not-observable`. With the daemon answering correctly, the model still said `UNKNOWN` about a
closed editor — because "not observable" reads as *I could not observe it*, which is ignorance,
not absence. Renamed to `answering` / `not-answering` / `cannot-tell`, the same model on the same
desk answered `NOT-RUNNING`. Nothing changed but the word. The three-state design exists to keep
ignorance separable from a no, and the first spelling of it quietly merged them again.

## What this does not show

One desktop, one toolkit, one model, one run per side. It shows the field is real, is wired to the
desk rather than to the model's memory, and changes across a launch — not that every application on
every platform answers the bus. An application that is open and publishes nothing reports
`not-answering`, which for a caller is the same wall; the schema says so rather than pretending
otherwise.

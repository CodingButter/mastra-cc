# What language each backend wants

The M0.5 ruling on Q07, Q08 and Q09. Every claim here carries a receipt: a
command that ran, a file and line, or a measurement. Where a question is not
settled, it says so and names what would settle it.

## The ruling

**One process, one language: Node.** The daemon needs no Python and no compiled
native module for the two backends that exist today.

| Backend | Language | Binding | Licence | Maintenance | Receipt |
|---|---|---|---|---|---|
| Linux accessibility | **Node** | `dbus-native` (plain D-Bus, no wrapper) | MIT, read from the shipped `LICENSE` file | last commit 2026-08-02, 10 open issues | [read](can-node-read-the-accessibility-tree.md) · [events](can-node-be-told-the-desktop-changed.md) · [write](can-node-act-on-the-desktop.md) |
| Chromium / browser | **Node** | none — the built-in `WebSocket` | n/a, no dependency | n/a | [substrate](what-the-browser-protocol-gives-us.md) |
| Windows | *undecided* | — | — | — | not investigated; see below |
| macOS | *undecided* | — | — | — | not investigated; see below |

## How the Linux answer was reached

The premise behind choosing Python was that the accessibility bindings require
it. That premise does not survive: **AT-SPI is D-Bus underneath.** `libatspi` is
a convenience wrapper over a published bus protocol, not a private channel into
it, so any language with a D-Bus client can speak it.

Node was then required to demonstrate all three things a daemon actually does,
because none of them implies the others:

- **Read** — finds the same 18 applications the Python bindings find on the same
  desktop at the same moment; roles and states readable on every node reached.
- **Subscribe** — receives events attributable to a window it opened, 138ms from
  cause to signal.
- **Write** — inserts text and verifies it by reading back; invokes an action and
  verifies it by the window disappearing.

## The two findings that cost the most to get

**A read that lies.** `GetText(0, -1)` — start of field to end of field —
returns an **empty string** over the bus even when the field is full. The `-1`
sentinel is a courtesy of the bindings, which translate it to the character
count before sending; the wire protocol has no such convention. A daemon written
the obvious way would report every text field on the system as empty *and* judge
each of its own successful writes a failure. Found only because the spike
verified writes by content instead of trusting return values.

**The same widget, two names.** The bus and the bindings describe the same 18
nodes with different role vocabularies — `button` against `push button`,
`generic` against `panel`, `text box` against `text`. The neutral vocabulary the
architecture already requires is therefore **per-route, not merely
per-platform**. A locator written in one dialect matches nothing in the other,
and the failure looks exactly like an element that has vanished.

## Q08: the threading claim, corrected

The claim was that concurrent access produces *silent data corruption rather
than a loud error*, and it lived in a docstring. Measured, it is wrong in its
particulars and right in its conclusion: concurrent access **aborts the process
immediately and deterministically** — `SIGTRAP`, before a single read completes,
with a diagnostic on standard error. One worker thread through the identical
code path succeeds every time; two do not. Checked at two, three, four and eight
threads, twice each, on **two unlike machines** (Wayland and X11), without
variation.

The single-threaded design survives with a better justification. A
silent-corruption risk can only be met with careful review, since violations
would be invisible; a deterministic crash can be asserted at startup and tested
cheaply. Full detail: [is-the-accessibility-binding-thread-safe.md](is-the-accessibility-binding-thread-safe.md).

## Candidates considered, and why the obvious one was rejected

Licence and maintenance are recorded separately, because *permissive but
abandoned* is a distinct failure from *not permissive* and both disqualify.

| Package | Licence | Last commit | Last publish | Open issues | Verdict |
|---|---|---|---|---|---|
| `dbus-next` | MIT | 2022-04-02 | 2021-10-10 | 51 | **rejected** — abandoned |
| `dbus-native` | MIT | 2026-08-02 | 2026-07-30 | 10 | **selected** |
| `@homebridge/dbus-native` | MIT | 2026-07-25 | 2026-08-08 | 0 | viable alternative |

`dbus-next` is the first result for the obvious search and the one most
tutorials name. It has not been committed to in four years.

Note on method: GitHub's API reports `NOASSERTION` for the licence of both live
candidates. The MIT determination comes from reading the `LICENSE` file in the
installed package, not from a manifest field or a badge.

## What is not settled

**Windows and macOS.** Neither was investigated. The plan scoped this milestone
to the backends that exist, and extending the ruling to platforms nobody has
probed would be exactly the kind of confident guess this milestone exists to
eliminate. What the evidence so far suggests — and it is a suggestion, not a
finding — is that the same question should be asked the same way: is the
platform's accessibility API reachable over an interface Node already speaks, or
does it require a native module? That is a day of work per platform and it is
M1's problem at the earliest.

**Whether one process is the right shape.** This settles that one *language* is
sufficient. Whether the browser and accessibility backends should share a
process, given that one of them can be killed by a stray thread, is a design
question rather than a measurement, and it is not answered here.

## Receipts

```
node spikes/daemon/node-atspi.mjs
node spikes/daemon/node-atspi-events.mjs
node spikes/daemon/node-atspi-write.mjs
python3 spikes/daemon/thread-safety.py --threads 8 --reads 40
```

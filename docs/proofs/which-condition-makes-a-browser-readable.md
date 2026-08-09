# Which condition makes a browser readable?

The artifact the prototype specified and never produced. Each row is one run of
`spikes/browser/a11y-conditions.py`, which is deleted at the end of M0.5.

`IsEnabled` and `ScreenReaderEnabled` are shown as **before / after** the run,
so that the question "does connecting an assistive client switch accessibility
on?" is answered by observation rather than by belief.

A run that cannot complete its walk, or that finds no browser on the
accessibility desktop, writes nothing at all.

| Condition | `IsEnabled` | `ScreenReaderEnabled` | Desktop children | Nodes walked | Web-content roles | Which |
|---|---|---|---|---|---|---|
| `baseline` | False / False | False / False | 19 | 2 | **0** | — |
| `assistive-attached` | False / False | False / False | 19 | 2 | **0** | — |
| `force-flag` | False / False | False / False | 19 | 202 | **63** | document web×1, entry×1, push button×61 |

## What the rows mean

"Web-content roles" counts nodes whose role only exists if the renderer's own
tree is exposed — documents, links, entries, headings, paragraphs. A browser
window always publishes a frame and an application object, so a non-zero node
count is not evidence of readability. This column is.

## What the `assistive-attached` row does and does not test

That row is a real assistive client — it connects to the accessibility bus
before the browser launches, registers event listeners, and stays connected
throughout. It is *not* a screen reader.

What was deliberately **not** tested is the stronger condition: a client that
announces itself by setting `org.a11y.Status`. Reaching it requires either
writing a system-wide property, which this milestone's do-not list forbids, or
starting a screen reader on the operator's desktop, which would begin speaking
aloud. Neither is an acceptable cost for a measurement, so the question is
closed as far as it can honestly be taken here and the remainder is named
rather than guessed: **does a client that sets `org.a11y.Status.IsEnabled`
cause Chromium to build its renderer tree?** Settling it needs a disposable
desktop session, not this one.

The practical answer does not depend on it. The launch flag is measured, it
works, and per amendment A1 the assistant launches the application itself — so
the flag is always available at the moment it is needed.

## The prototype's claim, refuted

`computer-controls/docs/07-open-questions.md:19-22` states that a browser whose
accessibility layer is unreadable is *absent from the accessibility desktop
entirely*. It is not: it is present and empty, on both a Wayland and an X11
session. That is a different problem with a different fix, and the distinction
matters — "absent" suggests waiting for it to appear, "present and empty"
tells you the tree is there and the content is not.

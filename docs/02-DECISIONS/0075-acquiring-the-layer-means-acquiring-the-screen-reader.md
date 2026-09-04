# 0075 — Acquiring the layer means acquiring the screen reader

**Status:** accepted
**Date:** 2026-09-04

## Context

`--acquire-accessibility` let the daemon switch this machine's accessibility layer on by
writing one property: `org.a11y.Status.IsEnabled` (`daemon/src/accessibility/linux-atspi.ts`).
That write is what brings the accessibility bus up, and every GTK and Qt application on the
demo desktop published a full widget tree behind it. The desk read as acquired, and for
native applications it was.

A browser was not. Measured on the demo container on 2026-09-04, with the daemon started
`--acquire-accessibility` and Chromium showing a Google Images results page,
`discoverElements({ application: "chromium" })` returned five entries: the application root,
four windows, and a `Restore pages?` dialog. Not one page control. The window nodes had no
children at all — the same shape ADR-0062 records for Qt 6 without its knob, where "the
process registers an application root on the accessibility bus but publishes NO subtree".

The cause is that a Chromium-family browser reads a *second* property. `IsEnabled` brings up
the bridge for the browser's own native chrome; `ScreenReaderEnabled` is what makes the
renderer publish the web page. On the demo container that property read `false` while
`IsEnabled` read `true`, and setting it to `true` — with no command-line flag, on a browser
started afterwards by its ordinary desktop entry — made the page tree appear in full:
buttons, links, and the search control an agent needs.

This mattered because it defeated the feature shipped one commit earlier. `discoverElements`
(ADR-0074) exists so an agent can learn an unfamiliar interface's vocabulary instead of
guessing predicates. The interface an agent most needs that for is a web page, and a web page
was precisely where the desk published nothing.

The alternative fix was `--force-renderer-accessibility` on the browser's argv. It works —
also measured — and it was rejected. ADR-0062 draws the line this repository already lives by:
accessibility enabling generalises through environment and session state, not argv, because
"toolkits ignore environment variables they do not read, which is exactly the property argv
flags do not have". An argv fix would need a built-in recipe per browser, would fight the
machine's own desktop entry (which on the demo image is a wrapper that supplies the sandbox
flags the raw binary needs), and would do nothing for a browser a human started from the menu.
A session property fixes every Chromium-family browser on the desk, however it was started,
including ones already running.

## Decision

**Acquiring the accessibility layer writes both status properties, and a desk that takes one
without the other is a failed acquire, not a partial one.**

`acquire()` writes `IsEnabled`, then `ScreenReaderEnabled`. Both are required. If the first
write is refused the second is never attempted and the acquire throws, as before. If the
first lands and the second is refused, the acquire still throws.

That last case is the point of the decision. A desk with `IsEnabled` alone answers `enabled`
to every measurement the daemon takes, shows every native application in full, and is blind
inside every browser on it. It is the most expensive failure this layer can produce, because
it looks like success everywhere an operator would think to check. Refusing it out loud costs
an operator a legible error on a read-only status object; accepting it costs an agent a
silently unreadable web, discovered only by an agent guessing into an empty tree.

The daemon is an assistive technology client. Saying so on the bus is not a claim it has to
apologise for — it is what it is, and applications that publish more for a screen reader are
publishing it to exactly the right kind of caller.

## Consequences

`report()` is unchanged: it reads `IsEnabled` and answers `enabled`, `disabled` or
`cannot-tell`. The state contract still means "is this machine's accessibility layer up",
which `IsEnabled` is the property for, and the server's disabled-by-configuration routing
still keys on it. A desk whose `ScreenReaderEnabled` is switched off by something else after
a successful acquire will therefore still report `enabled` while browsers go quiet on it.
That gap is known and deliberate: closing it means changing what a reported state means, and
this decision is about the write, not the reading.

Operators who cannot or will not present as a screen reader keep the same escape they always
had — do not pass `--acquire-accessibility`, and set the session up by hand. Nothing here
acquires anything the operator did not already authorise; it acquires the whole of what that
authorisation was always for.

## Evidence

Measured on the demo container (`mcc-desk-demo`, KDE on Xvfb, Chromium 140) on 2026-09-04,
against the daemon it was already running with `--acquire-accessibility`:

- Before. `gdbus` on the session bus read
  `{'IsEnabled': <true>, 'ScreenReaderEnabled': <false>}`, and
  `discoverElements({ application: "chromium", limit: 200 })` over a live Google Images
  results page returned five entries — `application "Chromium"`, `window ""` ×4,
  `window "mastra ai logo - Google Search - Chromium"`, `dialog "Restore pages?"` — and no
  descendants of any of them.
- The argv route, for comparison. Chromium restarted with `--force-renderer-accessibility`
  published the full page tree, confirming the browser was capable and merely unasked.
- After. With Chromium killed, `ScreenReaderEnabled` set to `true`, and the browser restarted
  through its ordinary desktop-entry wrapper and **no** accessibility flag, the same
  discovery call returned the page: buttons carrying real image titles, `Back`, `Apps`,
  `All Bookmarks`, `Bookmark this tab`, and the page's own controls.

`daemon/src/accessibility/__tests__/acquiring.test.ts` pins the write pair and its order, that
a refused `IsEnabled` never reaches the second property, and that a session accepting
`IsEnabled` while refusing `ScreenReaderEnabled` throws instead of half-acquiring.

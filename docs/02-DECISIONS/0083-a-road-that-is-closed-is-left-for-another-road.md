# 0083 — A road that is closed is left for another road

Status: superseded by [0086](0086-a-key-is-not-sent-into-another-applications-window.md)

The measurement below stands: Plasma's wallpaper grid publishes no selection
and `Apply` never wakes, for our pointer or for a real one. The REMEDY does not.
Sending the errand to a command line was working around a bug that was ours -
keys landing in whichever window happened to be in front - and a person setting
a wallpaper does not open a terminal. The desk offers other windows that finish
the same errand through the pointer; 0086 fixes the wrong-window bug and the
instructions now say so.
Date: 2026-09-05
Schema: 1.18.0 (no protocol change; instructions only)

## Context

Setting a wallpaper was the errand this project used to find its own holes, and
it found five real ones: `clickElement` (ADR-0078), the reveal that believed a
flag (0079), ownership mistaken for presence (0080), the press at a greyed-out
control (0081) and a desk that could not say where its files lived (0082). After
all five, runs still failed — and always on the same window.

Measured by hand at the desk on 2026-09-05, through the shipped transport:

- Plasma's wallpaper grid items publish `['enabled', 'sensitive', 'showing',
  'transient', 'visible']` before a press and exactly the same states after one.
  Their parent is a `panel` exposing `Accessible, Action, Component` — no
  `Selection` interface, no `SELECTED` state anywhere in the subtree.
- `Apply` sits at `(1021, 751, 80, 25)` publishing `['focusable', 'showing',
  'visible']` and never gains `ENABLED` or `SENSITIVE`.
- This is not our pointer. A real `xdotool mousemove 1006 478 click 1`, at the
  centre of the thumbnail's own published rectangle, on the activated window,
  leaves `Apply` exactly as grey. So does clicking `Apply` afterwards: no
  `Image=` key appears in `plasma-org.kde.plasma.desktop-appletsrc`.

The page is unfinishable through what it publishes, and there is nothing to fix
in this repository that would change that. Runs spent 100 to 197 steps on it and
then, twice, reported a wallpaper the desktop never received.

The same errand completes in two verbs of the existing contract:
`typeText` of `plasma-apply-wallpaperimage /config/Downloads/...` into Konsole
and `sendKeyChord` `Enter`, after which line 19 of the configuration file reads
`Image=file:///config/Downloads/mastra-logo-wordmark.png`. Konsole obeys both
and publishes not one character of its screen — `content: not-exposed` on the
window and no text node under it — which is why a run that judged the command by
what it could read there concluded the command had failed.

## Decision

No verb changes. The instructions gain two paragraphs, pinned by substance:

1. A control that does not change after the thing was pressed and read back
   **twice** is a closed road, and the desk is a whole machine: the terminal is
   an application like any other, and a command is a legitimate way to do work
   the window will not do.
2. A terminal is written to and never read. Its silence is the terminal being a
   terminal. Proof comes from somewhere that publishes — the changed file opened
   at a `file://` address in the browser.

Pinned in `packages/desktop/src/__tests__/the-prose-keeps-what-a-desk-taught-it.test.ts`
with mutation anchors `prose-that-lets-an-agent-grind-a-page-that-never-wakes`
and `prose-that-reads-a-terminals-silence-as-a-failure`.

## Consequences

An agent stops grinding at accessible dead ends and reaches a road it was
already permitted to use. The evidence standard does not move: the claim is
still read off the desk, and the terminal is explicitly disqualified as a
witness.

The cost is real and worth stating. Telling an agent to type commands makes the
shell a first-class road, and a shell can do far more than the window it stood
in for; every guard this project has lives in front of the *verbs*, not in front
of the *command line*, and this paragraph invites traffic to the place with the
fewest guards. It is accepted here because the terminal is an ordinary
application on the catalogue, opened under the same ownership rules as any
other, and because the alternative measured worse: 197 steps of pressing a
button that was never going to wake, ending in a false report.

Second cost: "read it back twice, then stop" is a heuristic, not a law. A window
that is merely slow will be abandoned one exchange too early.

## Evidence

- `docs/02-DECISIONS/0081-...md` — the greyed-`Apply` refusal that fires here
  correctly and still leaves the page unfinishable.
- By-hand probe, 2026-09-05: grid item `Kubuntu Light` extents `(914, 393, 184,
  170)`; states identical before and after both a daemon press and a real
  `xdotool` click; `Apply` states `['focusable', 'showing', 'visible']` throughout.
- By-hand completion, 2026-09-05, through `typeText` + `sendKeyChord` on the
  Konsole window: `plasma-org.kde.plasma.desktop-appletsrc:19` became
  `Image=file:///config/Downloads/mastra-logo-wordmark.png`, wallpaper 4096×1001.

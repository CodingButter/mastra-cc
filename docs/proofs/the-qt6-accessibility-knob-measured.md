# The Qt6 accessibility knob, measured

Produced by running `.proof/qt6.sh` (the untracked M2.5 proof leg) on
**minibeast** under Wayland, 2026-08-13. This document is the committed home of
the measurement that closed Q05's Qt row in
[09-QUESTIONS.md](../09-QUESTIONS.md) — the transcript below is the leg's
sanitized output, quoted whole.

## The question

Qt applications on Linux publish an accessibility tree only when asked. The Qt
documentation names two asks: the session's AT-SPI DBus properties (set by a
running screen reader), or the `QT_LINUX_ACCESSIBILITY_ALWAYS_ON` environment
variable. The Qt5 era had a third, `QT_ACCESSIBILITY=1`. Which one actually
matters on Qt 6, on a machine with no screen reader running?

## The measurement

Three states, each asserted by the leg — a failed assertion fails the run.
The probe application is `qt6ct` (the Qt6 Configuration Tool, package
0.9-2build2, Qt 6.4). States A and B launch it directly because a
knob-baking recipe cannot be asked to launch knobless; state C is the shipped
behavior — the daemon's own `qt6ct` recipe
([daemon/src/launch/recipes.ts](../../daemon/src/launch/recipes.ts)), which
bakes the always-on variable, with both the launch and the tree walk performed
by the daemon.

```text
== qt6 leg: 2026-08-13T07:15:12Z ==
os: Ubuntu 24.04, session type: wayland
qt6ct package: 0.9-2build2
session a11y properties at run time (all expected false - no screen reader here):
b false
false

== state A: bare launch, both knobs explicitly unset ==
application roots on the bus named qt6ct: 1
  not found: "Hide"
  not found: "Information"
  not found: "Qt6 Configuration Tool"
state A widget names found: 0

== state B: QT_ACCESSIBILITY=1 (the Qt5-era knob) ==
  not found: "Hide"
  not found: "Information"
  not found: "Qt6 Configuration Tool"
state B widget names found: 0

== state C: daemon launch via the qt6ct recipe (QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 baked) ==
openApplication qt6ct: application role=application
  found: "Hide"
  found: "Information"
  found: "Qt6 Configuration Tool"
state C widget names found: 3

== verdicts (asserted, not narrated) ==
A (bare): root registered, 0 widgets. B (QT_ACCESSIBILITY=1): 0 widgets. C (recipe knob): 3/3 widgets readable.
QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 is the knob that matters on Qt 6.4; the Qt5-era knob is a no-op.
== qt6 leg: green ==
```

## What this means

- **Bare launch registers but publishes nothing.** An application root named
  `qt6ct` appears on the accessibility bus with no subtree — visible existence,
  zero readable widgets.
- **`QT_ACCESSIBILITY=1` is a no-op on Qt 6.4.** Still zero widgets. The
  documented-but-wrong knob was measured, not assumed.
- **`QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1` is the knob.** With it baked into the
  launch recipe, the daemon's own launch-then-walk read all three probed widget
  names. Launch-time enabling, the same posture as GTK's `GTK_MODULES` —
  [ADR-0027](../02-DECISIONS/0027-the-assistant-opens-the-application-itself.md).

## The limit of this result

One machine (minibeast, Wayland), one Qt version (6.4), one application. Two
wrinkles are recorded in the Q05 close and repeated here rather than smoothed:
`qt6ct` registers **two** application roots and one stays permanently empty
even with the knob; and the atspi walk's 150-node-per-application budget
truncates this tree before its deeper tab and button rows — the daemon reads
real widgets, not necessarily all of them. The claim is confined to the three
states measured.

A rerun is one paste: `bash .proof/qt6.sh` from the repository root on a
machine with `qt6ct` installed.

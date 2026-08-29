# What the face does on a real desk

> **Retired 2026-08-28 — historical record.** This proof measured the client surface (face, widget, voice lane) removed by [ADR-0057](../02-DECISIONS/0057-mastra-cc-is-a-peripheral-not-an-assistant.md). The command that produced it no longer exists in the tree. It is kept because decisions still cite it as their evidence, and evidence deleted under a decision it justifies cannot be audited. Nothing here describes what ships today.


**Produced by:** `node tools/proofs/window-model.mjs --live --display <n>`
**Date:** 2026-08-23
**Host:** minibeast, kernel 7.0.0-28-generic
**Tree:** 225cc02

This artifact answers "does the face hold its place on a desk without stealing
focus" (docs/09-QUESTIONS.md). Every row below was read from the X server with
`xwininfo`, `xprop` or `xrandr`. The widget was never asked to report on
itself.

## Limitations, stated before the results

1. **The desk has two outputs, and they are synthesised outputs.** The Xorg
   `dummy` driver advertises two connected outputs; they are not physical
   monitors, and the tray is a standalone tray rather than a desktop
   environment's own. What this proves is that the widget's monitor and tray
   behaviour is correct against the interfaces X and EWMH expose - not that it
   looks right on glass. Three earlier desks (`xrandr --setmonitor`, Xvfb
   XINERAMA, and Xephyr with two screens) still gave Chromium one display; the
   dummy driver succeeds because it advertises two connected outputs with real
   CRTCs, the layer Chromium reads. The rendered-pixel capture is a separate
   artifact because geometry is not appearance.
2. **Box 3 holds with a condition.** A face carrying `_NET_WM_STATE_ABOVE` is
   buried by a full-screen window *while that window holds focus*, and returns
   to the top on its own when focus moves. Both halves are measured below.
3. **It is one window manager.** Openbox is a real EWMH window manager and it
   is exactly one of them; a different window manager may stack differently.
4. **No wake word, no microphone, no speech.** ADR-0016 decisions 9 and 10 are
   inert state in this milestone; their consequence arrives in M5.
5. **The element-highlight overlay is absent by decision** (ADR-0016 decision
   5), not by omission.

## The outputs this was measured on

- `DUMMY0` 1024x768 at 0,0
- `DUMMY1` 1024x768 at 1024,0

## Measurements

| Box | What | Command | Observed | Verdict |
|---|---|---|---|---|
| 1 | the window is managed, not override-redirect | `xwininfo -id 0x800003` | Override Redirect State: no | **pass** |
| 2 | always-on-top is set | `xprop -id 0x800003 _NET_WM_STATE` | _NET_WM_STATE(ATOM) = _NET_WM_STATE_ABOVE | **pass** |
| 2 | the window is in the window manager's client list | `xprop -root _NET_CLIENT_LIST` | contains 0x800003 | **pass** |
| 2 | showing the face did not make it the active window (decision 2) | `xprop -root _NET_ACTIVE_WINDOW, cleared before the face appears` | before: none - after: none | **pass** |
| 5 | the window has an input shape smaller than its rectangle (decision 4) | `xwininfo -id 0x800003 -shape` | shape extents 206x186+10+4, window 220x220 | **pass** |
| 3 | a focused full-screen window is above the face (the measured condition, ADR-0051) | `xprop -root _NET_CLIENT_LIST_STACKING` | face 0x800003 below full-screen 0x1000003 | **measured** |
| 3 | with no focused full-screen window, the face is top of the stack | `xprop -root _NET_CLIENT_LIST_STACKING` | face 0x800003 is top of the stacking order | **pass** |
| 4 | the face sits on the second output, where the X server confirms it | `xwininfo -id 0x800003` | Absolute upper-left X: 1084, Y: 120 (on DUMMY1) | **pass** |
| 4 | placement survives a restart, from a non-default position on the second output | `xwininfo -id 0x800003, xprop -id 0x800003 _NET_WM_PID` | stored: 1084,120 - after restart: 1084,120 (process 1023727 before the restart, 1023875 after) | **pass** |
| 6 | the tray-bound dismissal path unmaps the face without synthetic input | `kill -USR1 1023875; xprop -root _NET_CLIENT_LIST` | 0x800003 is unmapped | **pass** |

## What the desk row and the source witness each prove

- **Click regions (box 5):** the X-server row proves the built window carries a
  smaller input shape. `apps/widget/src/__tests__/clicks-land-only-on-the-face.test.ts`
  proves the orb, caption and menu are inside that shape and transparent points
  are outside it. Neither witness is silently promoted into the other.
- **Long progress (box 7):**
  `apps/widget/src/__tests__/the-face-hides-when-told.test.ts` advances an
  injected clock by 24 hours and proves progress remains visible; it also
  excludes timer-driven dismissal. The desk proves the same built widget can map and
  unmap through its real main-process visibility path; it does not pretend 24
  wall-clock hours elapsed during this capture.

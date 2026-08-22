# What the face does on a real desk

**Produced by:** `node tools/proofs/window-model.mjs --live --display <n>`
**Date:** 2026-08-22
**Host:** minibeast, kernel 7.0.0-28-generic
**Tree:** 732114a-dirty

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
   looks right on glass. The visual confirmation is a separate, human item.
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
| 1 | the window is managed, not override-redirect | `xwininfo -id 0x600003` | Override Redirect State: no | **pass** |
| 2 | always-on-top is set | `xprop -id 0x600003 _NET_WM_STATE` | _NET_WM_STATE(ATOM) = _NET_WM_STATE_ABOVE | **pass** |
| 2 | the window is in the window manager's client list | `xprop -root _NET_CLIENT_LIST` | contains 0x600003 | **pass** |
| 2 | showing the face did not make it the active window (decision 2) | `xprop -root _NET_ACTIVE_WINDOW, cleared before the face appears` | before: none - after: none | **pass** |
| 5 | the window has an input shape smaller than its rectangle (decision 4) | `xwininfo -id 0x600003 -shape` | shape extents 206x186+10+4, window 220x220 | **pass** |
| 3 | a focused full-screen window is above the face (the measured condition, ADR-0051) | `xprop -root _NET_CLIENT_LIST_STACKING` | face 0x600003 below full-screen 0x1000003 | **measured** |
| 3 | with no focused full-screen window, the face is top of the stack | `xprop -root _NET_CLIENT_LIST_STACKING` | face 0x600003 is top of the stacking order | **pass** |
| 4 | the face sits on the second output, where the X server confirms it | `xwininfo -id 0x600003` | Absolute upper-left X: 1084, Y: 120 (on DUMMY1) | **pass** |
| 4 | placement survives a restart, from a non-default position on the second output | `xwininfo -id 0x600003` | stored: 1084,120 - after restart: 1084,120 | **pass** |

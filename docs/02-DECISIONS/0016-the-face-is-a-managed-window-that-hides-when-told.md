# ADR-0016 — The face is a window the window manager manages, and it hides when told

**Status:** accepted
**Date:** 2026-08-08
**Carried forward from the prototype (PR #228, PR #231, issue #186, issue #203).**

## Context

The tray face — the orb — is the product's physical presence on the desktop, and the prototype got its window model wrong twice before getting it right.

**The first wrong model: an unfocusable window covering the whole display.** The reasoning seemed sound — the face must never steal what the user is typing into, so make the window unfocusable; and the face should be able to draw anywhere, so make it display-sized. On X11, both halves backfire:

- An unfocusable Electron window is **override-redirect**, which means the window manager does not manage it at all. No `_NET_WM_STATE_ABOVE`. No place in the stacking list. The always-on-top request was *silently discarded*, and "on top" degraded into raw stacking order that any full-screen window could bury.
- Because the window *was* the whole display, dragging the face only moved a drawing inside a window that never moved. The face could not leave the monitor it opened on. On a two-monitor desk this is not a polish issue; it is the face being stuck.

**The second wrong model: hiding on a timer.** The face auto-hid after a fixed quiet period. Jamie's complaint was exact and correct: *auto-hide is hiding even when there are agents actively trying to accomplish a task.* A face that vanishes while work is in progress is not tidy, it is a bug. The second half of his direction pointed at the answer — the orb should hide when *told* to, not when a clock runs out.

## Decision

**Window model:**

1. **The window is managed by the window manager.** The unfocusable flag is gone. Managed means `_NET_WM_STATE_ABOVE` is honoured and the window has a place in the stacking list.
2. **The never-steals-focus guarantee is kept by never activating the window** — the shell only ever shows it without activating, never `show()`/`focus()`. The guarantee is preserved by behaviour rather than by a flag that costs management.
3. **The window is the size of the face**, not the size of the display. Dragging moves the real window, across monitors, with edge and corner snapping, and placement persists across restarts.
4. **Click-through is shaped.** Clicks land on the orb, the caption, and the menu; anywhere else in the rectangle they pass straight through to whatever is behind.
5. **Consequences are accepted where they are honest.** A face-sized window cannot draw a highlight rectangle over another monitor, so that overlay is retired; the hub still reports what it touches, and drawing it needs its own surface if it is ever wanted again.

**Hiding model:**

6. **The face never hides while work is in progress.** `progress` and `answer` force it visible.
7. **Hiding is a gesture, not a timeout.** The same code path serves a tray click and a spoken dismissal — *"no"*, *"never mind"*, *"shut up"*. The gesture hides the face and clears the caption.
8. **Dismissal does not cancel work.** Sending the user's face away is not cancelling the user's task.
9. **Dismissal does not disarm the wake word.** Being told *no* ends the conversation, not the ability to start another.
10. **A decline is a complete turn.** The voice model's instructions say so in plain language; it acknowledges briefly and ends the session, and ending the session actually closes the microphone gate rather than leaving a silence timer to run out. The layer holding the microphone deliberately cannot read what was said — it matches shape and forwards, nothing more.

## Consequences

**Good.** The face behaves like a window on a desk with more than one monitor, stays on top for real, and leaves when asked instead of when a timer decides. All ten points above were verified live on a real dual-monitor X11 session, not asserted.

> **Correction, 2026-08-22:** The sentence above records the prototype evidence cited in this ADR; it is not a claim that this rebuild repeated every gesture on physical monitors. The rebuild's machine-scored evidence uses an Xorg dummy-driver desk with two connected outputs and a standalone tray. Its exact limits and measurements are recorded in [the M4 proof artifact](../proofs/what-the-face-does-on-a-real-desk.md).

**Cost.** The element-highlight overlay is gone until it gets its own surface. That was a genuine feature and its loss is the price of a face-sized window.

**Cost.** Shaped click-through is fiddly and has to be re-verified whenever the face's visual layout changes. It is covered by tests that assert clicks in transparent regions send nothing.

**Note for the rebuild.** Two prototype pull requests reached this area independently — one added a demo mode to work around the display-sized window, the other fixed the window model outright — and merging them required hand-reconciling two correct designs. Starting from the correct window model means the demo affordances are a small deliberate variation rather than a workaround with its own semantics.

## Evidence

| Claim | Source |
|---|---|
| unfocusable on X11 → override-redirect → alwaysOnTop silently discarded | PR #228 (closes issue #186), verified with `xwininfo` / `xprop` |
| display-sized window meant the face could not change monitors | PR #228 description |
| live verification: managed, `_NET_WM_STATE_ABOVE` present, in the stacking list, survives a full-screen window | PR #228 live run on a 3840×1080 two-monitor X11 desk |
| drag across monitors verified; placement survives restart | PR #228 live run |
| shaped click-through: clicks on the orb send a gesture, clicks in transparent area send nothing | PR #228 live run |
| highlight overlay retired, needs its own surface | PR #228 description |
| "auto-hide is hiding even when there are agents actively trying to accomplish a task" | Jamie, 2026-08-07 17:45 |
| progress/answer force visible; dismissal gesture; ears untouched | commit `8ee48c6` |
| dismissal does not cancel tasks; wake stays armed | commit `8ee48c6`; PR #231 |
| a decline is a complete turn; ending the session closes the mic gate | PR #231 (closes issue #223), issue #203 / PR #217 |
| the mic-holding layer cannot read what was said | PR #231 description |

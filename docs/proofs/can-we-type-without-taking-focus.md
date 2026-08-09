# Can we type without taking focus?

Produced by `spikes/browser/unfocused-input.mjs`, which is deleted at the end
of M0.5.

This is the measurement behind "the assistant works alongside you rather than
taking over the machine". If input can only be delivered to a focused window,
that principle is not implementable on the browser substrate and the design has
to say so.

| Observation | Measured |
|---|---|
| Desktop session | `wayland` |
| Target window unfocused before typing | **yes** |
| Other window held the keyboard before typing | **yes** |
| Typed text arrived intact in the target | **"typed while unfocused"** |
| `Enter` reached the page's key handler | **yes** |
| **Other window still held the keyboard afterwards** | **yes — it never lost the keyboard** |
| Target's own focus self-report | claims focus (both windows claim it at once — renderer bookkeeping, not OS focus) |

Text was also confirmed **not** to have leaked into the other window; the run
refuses to write this file if it did.

## The oracle problem, and why the last row is not the claim

The obvious way to measure this is to ask the window under test whether it has
focus after typing. That answer is worthless, and an earlier version of this
spike was misled by it: after input dispatch the target reports
`document.hasFocus() === true`, which reads like focus theft.

It is not. Measuring both windows at once shows **both reporting `true`
simultaneously**, which cannot be true of OS focus — only one window can hold
the keyboard. What that call reports is the renderer's own bookkeeping: a
widget that has been handed synthesized input marks itself focused, regardless
of what the compositor thinks.

So the claim is measured on the other window instead. "Did the window the human
is using ever lose the keyboard" is the question the product actually makes a
promise about, and it is the one row above in bold.

No independent compositor oracle was available to corroborate: GNOME Shell's
`Eval` method is disabled, so the desktop cannot be asked which window is
active. The two-windows-both-true result stands on its own — it is internally
decisive, since it disproves the oracle rather than depending on it — but an
X11 session, where the active window can be queried directly, would settle it
from the outside. Recorded as a known gap rather than papered over.

## Why the precondition is checked rather than assumed

The run verifies that the target is unfocused **and** that the other window
holds the keyboard before typing anything, and writes nothing if either is
false. Typing into a window that turned out to be focused would produce a green
result proving the opposite of what it claims, which is the exact failure shape
this repository treats as worse than having no test.

## The distinction that makes it work

Two different kinds of focus are involved and only one of them is the human's:

- **OS focus** — which window receives the keyboard. This belongs to the
  operator and is never taken.
- **DOM focus** — which element inside the document receives input. Set with
  `element.focus()`, which moves nothing on the desktop.

Input dispatched over the protocol is delivered to the renderer directly and
routed by DOM focus. It never enters the operating system's input queue, which
is why the operator's window keeps the keyboard throughout.

## What this does not cover

Only the browser substrate. Typing into a native application through the
accessibility layer is a different mechanism with a different answer, and on
that side taking focus may be unavoidable. These are two separate risk surfaces
and the product has to describe them separately rather than generalising from
this result.

## Receipt

```
node spikes/browser/unfocused-input.mjs --port 9461
```

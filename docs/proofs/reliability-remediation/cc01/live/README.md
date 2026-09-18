# CC-01 live: foreground, occlusion and a layout change that arrives too late

`PROOF: GREEN`

Three real GTK3 windows under Openbox on Xvfb - Target (a red window holding a
text entry), Cover (a blue window), and Shell (a task-bar stand-in with buttons
that present the other two) - driven through a real daemon over a Unix socket by
`driver.mjs`. No model runs: the driver replaces `fetch` with a throw.

What CC-01 asked for was not a guarantee that the desk can be prepared. It was
an honest account of what preparation does and does not buy, taken from a desk
rather than from a fake.

## What the run records

| Phase | Recorded |
| --- | --- |
| `covered-capture` | The capture of the covered entry is dominated by Cover's blue. `captureElement` answers visible desktop pixels, and occlusion is visible in the answer rather than asserted away. |
| `keystroke-while-covered` | `typeText` on the covered entry **lands**: the daemon grabs focus and the readback reads `'covered'`. Being drawn over is not being unreachable, and this contract does not pretend otherwise. |
| `raised-by-task-bar-button` | Activating the Shell's Target button raises Target through the desk's own route; a fresh capture is then the entry itself. |
| `keystroke-after-raise` | A key lands after the permitted route, and focus restoration does not put Cover back on top. |
| `press-from-old-picture-after-move` | Target moves 120 px; a press aimed from the last picture is **refused before anything is sent** - `the desk has moved under the picture` - and the field still reads `'raised'` (ADR-0107). |
| `covered-again` | Cover returns over the moved Target. A capture taken after that is blue again: an earlier successful preparation promised nothing about later occlusion, and only looking again says what is there now. |

The audit receipts for the run are 16 observe/read, 1 activate performed, 2
rawInput performed, 1 rawInput `refused:PointerBlockedError`. Every capture in
this run appears as an observe receipt and none as an input receipt: capture
takes no focus and sends nothing.

## The defect this run found

CC-07 shipped a freshness check in the ATSPI backend and tested it there. On
this desk the stale press landed anyway. The cause was one frame short of the
check: `clickElement` in `daemon/src/server.ts` built the backend call field by
field - `{ id, button, count, x, y }` - and never copied `capturedAt`, so the
caller's claim was dropped at the server boundary and the backend was asked to
check a claim it never received.

A dropped claim is worse than no claim: the caller is told its press was checked
against its picture while nothing checked anything. The server now carries
`capturedAt` through, and refuses a `capturedAt` that is not a finite number
rather than silently dropping it. Both edges are pinned by
`daemon/src/__tests__/a-press-inside-one-element.test.ts` and by the mutations
`the-press-forgets-the-picture-it-was-aimed-from` and
`a-picture-named-by-nonsense-is-pressed-anyway`.

## Boundaries

- One desk, one toolkit, one window manager. GTK3 under Openbox on Xvfb says
  nothing about other toolkits, compositors or a real GPU desktop.
- The task-bar button is a fixture stand-in for a shell, not a real panel.
- Cover is offset 20 px from Target: exactly coincident windows are answered as
  black by root capture under this Xvfb, which is a capture-stack artifact and
  not something this contract can claim about occlusion.
- Freshness catches a target that **moved** or was re-photographed. A target
  whose rectangle is unchanged but is newly covered is not detected by
  freshness - `covered-again` is what that looks like, and looking again is the
  only answer to it.

## Running it

```
rm -rf /tmp/cc01-live.*
python3 run.py session.sh <consumer-node_modules> <mastracode-package.json>
```

Retained evidence is in `evidence/` with `SHA256SUMS`.

# Can Node act on the desktop?

Produced by `spikes/daemon/node-atspi-write.mjs`, which is deleted at the end
of M0.5.

Reading and subscribing were settled by the companion spikes. Writing is the
half that touches the user's machine, and the half that decides whether the
Linux backend is Node end to end. Three interfaces are exercised, because
nothing about one implies another.

## Result

| | |
|---|---|
| Editable field and button found | yes |
| Actions advertised on the button | 1 |
| `EditableText.InsertText` reported success | yes |
| **Text verified by reading it back** | **yes** |
| The obvious read returns empty while the field is full | **yes** |
| `Action.DoAction` reported success | yes |
| **Action verified by its effect on the desktop** | **yes** |
| Out-of-range write refused rather than clamped | no |

## Why every row is doubled

A call that returns success has not thereby done anything. The two bold rows are
the ones that matter, and they are deliberately separate from the rows above
them: one asks whether the call reported success, the next asks whether the
world changed. The prototype documented a toolkit that clamped an out-of-range
offset and reported success, leaving the caller with a confident and wrong
belief — so the last row checks specifically for that behaviour rather than
assuming honesty.

Verification here is by content, not by return code: the text is read back and
compared, and the button press is confirmed by the application leaving the
accessibility desktop.

## The trap this spike walked into

`GetText(0, -1)` — start of the field to the end of it — **returns an empty
string over the bus even when the field is full.** The `-1` sentinel is a
convenience of the bindings, which translate it into the character count before
sending. The wire protocol has no such convention and answers with nothing.

This was found because the spike verified the write instead of trusting the
return value, and it initially reported `text-inserted: true` beside
`text-verified: false` — a write that succeeded and a verification that lied.

Both directions of the error are severe and neither announces itself:

- A daemon reading text this way reports **every field on the system as empty**.
- The same daemon verifying its own writes concludes they **all failed**, and a
  retry loop built on that would type the same thing repeatedly into a field
  that already had it.

The correction is to ask for the character count and read to it. The general
lesson is larger than one call: *the bindings are a convenience wrapper* cuts
both ways. Some of those conveniences are load-bearing, and speaking the
protocol directly means re-implementing them knowingly rather than discovering
them one silent wrong answer at a time.

## A second disagreement, and where it belongs

Node over the bus and the bindings see **the same eighteen nodes** in the same
window, and give them **different role names**:

| Over the bus | Through the bindings |
|---|---|
| `generic` | `panel` |
| `text box` | `text` |
| `button` | `push button` |

Same widget, same desktop, same moment. This is a concrete instance of exactly
what the architecture's neutral-vocabulary rule anticipated, and it sharpens it:
the role map is not merely per-platform, it is **per-route**. A locator written
against one vocabulary silently matches nothing when read through the other,
which is a failure that looks like the element having disappeared.

## What this settles

Node can read the tree, receive events, and act on it — the complete set a
daemon needs, with no Python in the process and nothing compiled.

## Receipt

```
node spikes/daemon/node-atspi-write.mjs
```

# Can Node be told the desktop changed?

Produced by `spikes/daemon/node-atspi-events.mjs`, which is deleted at the end
of M0.5.

Reading a tree once is not a daemon. The push model — *the desktop talks first* —
requires being told when something changes, and without it the design falls back
to polling, which the product documents rule out. The companion spike showed
Node can read. This one asks whether Node can be told.

**The spike causes its own event.** It opens a window, then closes it. A
listener that sits through a quiet window and reports nothing has measured
nothing, and would report the same thing if subscription were completely broken.

## Result

| | |
|---|---|
| Registered with the accessibility registry | yes |
| Caused an event on purpose | yes |
| Ambient signals in a quiet 3s window beforehand | 12 |
| Signals received after the window opened | 682 |
| **Traceable to this spike's own window** | **6** |
| A window event among those | no |
| Time to first signal | 134ms |
| First attributable signal | `Object.StateChanged` |

The ambient count is the reason the attributable count exists. An idle desktop
emits **12 accessibility signals in three seconds** with nobody
touching it, and 682 arrived during this run against
**6** that can actually be traced to the window this spike
opened. "Signals arrived while the window was open" is therefore not evidence of
anything at all, which is the entire reason for the attribution column.

Attribution is by **D-Bus sender name**, not by matching text in the payload.
An accessible object's identity is the owning application's bus name plus its
object path — the same fact the prototype established when it found that the
ids applications report are not unique. A first version of this spike searched
signal bodies for the window's title, found nothing, and refused; the title is
simply not what these signals carry.

Note that the attributable events are `Object.StateChanged`, and **no
`Window.*` signal was traceable to this window** despite registration for it.
That is recorded as observed rather than explained. It does not affect the
finding — the daemon needs to receive events attributable to a known
application, and it does — but anyone building on the window-event interface
specifically should treat it as untested rather than working.

## What this settles

Node receives accessibility events directly from the bus. Together with the
companion spike, the Linux backend needs neither Python nor a native module:
Node can enumerate, walk, read, and subscribe.

**Two match rules and two registrations are required, and missing either one
fails silently.** A subscriber with no match rule sits quietly forever and looks
identical to a calm desktop. That failure mode is the reason this spike causes
its own event, and it is worth carrying into the daemon as a startup assertion
rather than trusting that a subscription took.

**The bridge is a launch-time condition here too.** On a desktop where
`toolkit-accessibility` is off, the window published nothing until it was
started with the bridge module loaded. This is the same constraint Phase 1
reached for browsers, arrived at from the opposite direction: whether the
subject is Chromium or GTK, readability is decided when the application starts,
which is why the assistant launching the application is the design rather than a
limitation of it.

## What this does not settle

Nothing here concerns *writing* — invoking actions, setting values, typing. That
remains untested in Node, and it is the last thing standing between this and a
complete answer for the Linux backend.

## Receipt

```
node spikes/daemon/node-atspi-events.mjs
```

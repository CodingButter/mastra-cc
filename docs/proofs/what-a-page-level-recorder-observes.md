# What a page-level recorder observes

Produced by `spikes/browser/coverage-count.mjs`, which is deleted at the end
of M0.5. The question is not whether an injected page layer is useful — it is
whether it can be **relied on**, which is a number, not an argument.

## The number

**5 of 8** ways of causing an effect were observed by a
document-start injected layer. **3** were missed.

Every path counted here was verified to have actually caused its effect, and
never by asking the page: in-page effects are confirmed by a handler counter
the layer cannot reach, and effects leaving the page by the **test server's own
request log**. The server is used deliberately rather than CDP's Network
domain, which reports only the sessions it was enabled on — a worker's request
is invisible from the page's session, and an earlier version of this spike
miscounted exactly that as "the effect never happened". Paths that fail to fire
are not counted, and the run refuses to write this file if any of them silently
did nothing.

| Path | Injected layer |
|---|---|
| `element.click()` | observed |
| `dispatchEvent(new MouseEvent("click"))` | observed |
| `fetch()` | observed |
| `navigator.sendBeacon()` | observed |
| `form.requestSubmit()` | observed |
| `fetch() inside a Worker` | **missed** |
| `same-process iframe natives` | **missed** |
| `trusted click via Input.dispatchMouseEvent` | **missed** |

## The number is generous, on purpose

This is the *best* version of the idea, not a strawman. The layer patches six
effect-causing members plus `EventTarget.prototype.dispatchEvent`, which is why
the dispatched-event path is observed here. A narrower layer that patches only
`click()` — the shape reached for first during planning — misses that path
entirely: a dispatched event fires the real handler while the patched method is
never called. The coverage figure is therefore a function of how much is
patched, and every addition is another member somebody has to remember.

## What follows from it

The layer is an **instrument, not a gate**. It cannot be load-bearing for
enforcement, because the misses are not exotic: dispatching an event, using a
worker, or creating an iframe are ordinary things ordinary pages do, and each
of them costs one line.

This does not make it worthless. As a recorder it is the highest-resolution
signal available — element-precise, timestamped, and able to see the page's own
code acting, which no external observer can. It earns its place on the
condition that nothing depends on it for permission.

The enforcement boundary is elsewhere and is not made of JavaScript: the
browser profile bounds what is reachable at all, and the daemon's verbs bound
what may be done with it. Both sit outside the page, where page script cannot
reach them.

## Receipt

```
node spikes/browser/coverage-count.mjs --port 9426
```

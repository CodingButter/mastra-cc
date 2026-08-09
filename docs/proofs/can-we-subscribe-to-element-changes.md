# Can we subscribe to element changes?

Answers Group G's **G2** — does a change subscription fire for Chromium content
that did not exist when the subscription was made? Produced by
`spikes/browser/subscribe-changes.mjs`, which is deleted at the end of M0.5.

## Mechanism

| Piece | CDP method | Role |
|---|---|---|
| Push channel | `Runtime.addBinding` | the page calls a function, we receive `Runtime.bindingCalled`. No polling, no return trip. |
| Trigger | `MutationObserver` (page-side) | watches a subtree, batches records |
| Persistence | `Page.addScriptToEvaluateOnNewDocument` | reinstalls before page script on the next document, so navigating does not drop the subscription |

## Measured

| Observation | Value |
|---|---|
| Binding installed | `__spikeNotify` |
| Observer installed on | `observing BODY` |
| Navigation persistence | `initScriptId=1` |
| Events before the click | 0 |
| Content actually materialised | **yes** |
| Subscription reported it | **yes (role=menuitem)** |
| Click to event, end to end | **253ms** |

**G2 is answered: yes.** An element that did not exist when the subscription was
made, created asynchronously 250ms after a click, was reported through the push
channel without anything polling.

## Why the spike causes its own event

An earlier version attached to a live application and watched for a fixed
period. When nothing happened during one such window it recorded
"the subscription did not fire for new content" — an *unexercised* condition
written down as a negative result, which is the same failure as a partial
table and worse than no measurement at all.

It now causes the change itself and refuses to write this file in either
direction of failure: if the content never appeared, and separately if the
content appeared but the subscription missed it. The existence check is made
independently of the subscription, because the subscription is the thing under
test and cannot also be the judge.

## How this reaches the agent

This measures the transport at the browser end only. A change observed here is
delivered onward as a **signal**, which is the mechanism an agent already has
for receiving events it subscribed to. Two consequences beyond tidiness.

An agent waiting on a signal is **idle**, not looping. Nothing polls at any
layer: the page calls a binding, the daemon receives an event, the agent
receives a signal.

And a **high-priority** signal can wake a run that suspended mid-task. That is
precisely what the execution model needs in order to pause at the moment of
uncertainty — a run that must ask the operator something goes idle and is woken
by the answer. An element changing and a human answering are the same shape of
event to a suspended run, which collapses two mechanisms into one, and it makes
asking cheap. Asking has to be cheap for ask-when-uncertain to be the default
rather than something the design avoids.

## What the recorder reports

Shapes, never values: element ids, roles and counts. Text content is never read,
so the subscription cannot quietly become a transcript. That constraint belongs
in the design, not only in this spike.

## The finding that was not the point of the spike

During an earlier run against a live Discord, a message arrived mid-run. It was
**the operator typing into the same window** the spike was attached to. Two
consequences, and the second invalidates a decision taken the previous night.

**Co-tenancy, in its easy form.** A human and the agent used one application
instance during the same session, and the agent never took focus or moved the
caret. The message was sent deliberately, to exercise the subscription, and it
was **sequential** — it did not overlap an agent write. So what is shown is that
a human can work in an application the agent is attached to without interference
from the attachment. What is **not** shown is the hard case: two writers editing
the same element at the same instant. The prototype's "computer roommate"
hazard — no per-element write lock, two clients interleaving word by word —
remains untested.

**An unmatched effect is not a divergence event.** The design conversation had
adopted this rule:

> Every effect observed in the page must correspond to an audited daemon verb
> call. An unmatched effect is a divergence event.

That rule is wrong. The operator's own message produces an unmatched effect, and
so does every notification, every presence change, and every message any other
person sends. A tripwire on unmatched effects fires continuously during ordinary
use, and one that fires continuously gets switched off — worse than never
building it, because the switching-off is silent.

The mechanism survives with its meaning inverted: it is **attribution**, not
detection. We know which actions we issued and when, so an observed effect
matching none of them is **labelled `external` and recorded** — never flagged,
and never dropped. Both halves matter: an unattributed effect is not an alarm,
but it is also not noise, and without it the audit answers "what did the agent
do" while being unable to answer "what happened". An agent mid-task that sees an
external edit to the element it is working on should yield to the human. This
reuses the prototype's own attribution vocabulary rather than inventing one.

Authorship was **not** determinable from the rendered interface — a Discord
message with no author header means *same author as the message above*, which is
the opposite of the "new author" reading first assumed here. Attribution has to
come from correlating our own issued actions, never from reading the screen.

## Receipt

```
node spikes/browser/subscribe-changes.mjs --port 9455
```

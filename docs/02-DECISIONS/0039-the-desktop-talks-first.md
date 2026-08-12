# 0039 — The desktop talks first

Status: accepted, 2026-08-11 (M2.4)

## Context

Everything the wire could do until now, it did because a client asked. Six
methods, all request/response, all initiated by the side that holds no
authority. That shape cannot express the thing this product is for: a person's
desktop changing while nobody asked it anything. The product doc has said so
since before there was a daemon — "**Push, not pull.** The desktop talks first
... Clients subscribe to changes rather than polling for them"
(`docs/00-PRODUCT.md:119`) — and the roadmap's M2 deliverable names the same
thing (`docs/07-ROADMAP.md`). This record implements pre-declared architecture;
it does not invent it.

Polling was never a candidate. On the accessibility route it is ruled out by
measurement rather than taste: a spike counted **18 ambient signals in a quiet
three-second window** and 639 after the window opened
(`docs/proofs/can-node-be-told-the-desktop-changed.md`). On the browser route
the push channel already exists and was measured: an element created
asynchronously 250ms after a click was reported end-to-end in **253ms**
(`docs/proofs/can-we-subscribe-to-element-changes.md`). A poll loop fast enough
to compete with that number would be a busy loop; a poll loop slow enough to be
cheap would miss the thing it was watching for.

The second half of this record — attribution — exists because of a rule that
was **wrong and got measured wrong**. The original intent was a tripwire: every
observed effect must correspond to an audited daemon verb, and an unmatched
effect is a divergence event. The M0.5 spike killed it. The operator's own
typing, an arriving notification, a contact coming online and another person's
message all produce unmatched effects continuously, so the tripwire "fires
constantly during correct use ... A tripwire that screams during normal
operation gets switched off within a week, and then the instrument is gone too"
(ADR-0032, clause 4). The mechanism survives with its meaning inverted.

## Decision

The wire gains a push direction, at **schema version 1.3.0**, and every pushed
change says who caused it.

1. **Subscriptions are subtree-scoped, and scope is the defence.**
   `subscribeElement` takes one element id and watches that element and its
   descendants. It is not a firehose with a filter bolted on: the noise is
   dropped at the source, before it becomes anyone's problem. A coalescing
   budget exists as a backstop for a subtree that genuinely churns, not as the
   design. This is the lesson Orca has been living with for two decades in its
   event manager (`docs/09-QUESTIONS.md:222`, Q06).

2. **Priority is carried, never interpreted.** A subscriber declares `low`,
   `medium` or `high`; the daemon stores it, stamps it onto every event of that
   watch, and **branches on it nowhere**. Whether a `high` is worth interrupting
   an idle run for is a decision made entirely above the wire. The daemon has no
   notion of a signal, a wake, an idle run, or of who is connected to it — a
   client is a socket that agreed on a schema digest. Keeping the daemon
   ignorant of its client is what lets the client be replaced without touching
   the daemon (ADR-0017's rule, applied in the other direction).

3. **An event is a pointer, never a payload.** `changeEvent` carries
   `{subscriptionId, id, role, kind, attribution, causeId?, priority, at}` and
   **no name, value, text, or content field of any kind**. Reading what
   changed is a separate `attestElement` call, which runs the visibility gate
   again. The reason is not tidiness: a subscription that carried values would
   become a transcript of everything the person typed, and it would do so
   without any further decision by anybody. The spike held the same line —
   "shapes, never values ... so the subscription cannot quietly become a
   transcript" (`docs/proofs/can-we-subscribe-to-element-changes.md`; ADR-0032
   clause 2).

4. **Attribution is exactly three values, and the undecidable one is real.**
   `self` (this session caused it, and the event names the call that did),
   `external` (something outside this session's causal scope did — *this is
   news*), and `unattributed` (undecidable, and **deliberately not guessed**).
   The three are already the project's vocabulary (`docs/08-GLOSSARY.md:43`);
   this record puts them on the wire. `causeId` is present **if and only if**
   the attribution is `self` — the generated validator enforces the biconditional
   (`protocol/generate.mjs`), so an event cannot claim a cause it does not have
   or hide one it does.

5. **The rule that produces those values is mechanical, and it is cheap because
   of a decision already made.** The server serialises every backend call
   (`daemon/src/server.ts`, `serialised()`), so **at most one cause is ever open
   at a time**. Therefore: no verb in flight → `external`; a verb in flight
   whose application contains the changed element → `self`, carrying that
   call's cause id; a verb in flight in a *different* application → the change
   is concurrent with something of ours but not caused by it, which is
   `unattributed`. There is no model, no heuristic, and no reading of the
   screen involved.

6. **Authorship is never read off the interface.** The spike's Discord case was
   first read the opposite way, and the correction is load-bearing: a message
   with no author header renders identically whoever sent it. Attribution comes
   from correlating our own issued actions and from nothing else. A route that
   can identify the sender of a change out-of-band may use that (the
   accessibility route's D-Bus sender name); a route that cannot must answer
   `unattributed` rather than infer.

7. **`self` is unreachable live in this milestone, and we say so out loud.**
   The only effect-class verb that works today is `openApplication`, which
   *creates* the application — so nothing could have been subscribed to inside
   it beforehand. Every live transcript this milestone can honestly produce
   shows `external` and `unattributed` only. The `self` branch is real code with
   a real test, exercised offline against a taped event inside a launched
   application's window. Claiming a live `self` would require an edit verb, and
   the edit class is still refused by name (ADR-0037).

8. **A vanished root ends its subscription, loudly.** When the watched element
   leaves the tree, the daemon emits a final event of kind `watchEnded` naming
   it and closes the subscription. It does **not** re-resolve the element by
   name and re-anchor: element identity is derived from position, not claimed
   (`daemon/src/backends/atspi/identity.ts`), so a re-rendered element is a
   different element and silently pointing the watch at it would be the same
   class of lie ADR-0038 refused for launch identities. Going quiet instead is
   worse still — silence is indistinguishable from a calm desktop, which is the
   failure mode the accessibility spike had to redesign around.

9. **An event for an application outside the visibility set is never emitted at
   all.** Not filtered late, not delivered-and-labelled: an unpermitted
   application is invisible, and its changes do not exist as far as this session
   is concerned (ADR-0036). The observable behaviour is byte-identical to a
   quiet desktop, which is the same property `UNAVAILABLE_REFUSAL` gives the
   launch path (ADR-0008 rule 6).

10. **Subscriptions die with the connection.** They are per-connection state,
    not daemon state. A client that disconnects leaves nothing behind — no
    orphan watch, no backend subscription still consuming events for nobody.

## Consequences

- **The audit record can finally answer "what happened", not only "what did the
  agent do".** That was ADR-0032's stated purpose for keeping every effect
  routed through daemon verbs: "not for security, but for accounting".
- **We gave up an enforcement property — but it was never available.** The
  divergence tripwire is gone for good. What replaces it is weaker on paper and
  actually usable, and ADR-0032 already recorded that the feeling of enforcement
  is worse than none.
- **`unattributed` will be common on the accessibility route, and that is the
  honest answer.** 18 ambient signals in a quiet 3-second window, only 6 of 639
  traceable to the spike's own window. A route that cannot attribute says so.
- **Two methods ship refusing.** Following ADR-0037's precedent, both
  `subscribeElement` and `unsubscribeElement` are defined and answer named,
  byte-stable refusals before either route can serve them. A method that does
  not exist cannot be refused honestly, and the contract is the thing being
  frozen.
- **The client gained a second message shape to handle.** A `{"type":"event"}`
  line has no `id` field, because it answers nothing. Every client of this wire
  must now route on message type rather than assuming a reply. The transport
  refuses to drop protocol traffic it does not recognise as its own — an event
  for an unknown subscription is delivered anyway, because the client is the one
  that knows whether it still cares.
- **The event direction is server→client only.** A client that sends a line of
  `type: "event"` is refused by the malformed-line path; a client cannot inject
  a change into its own stream.
- **`at` is the daemon's observation time, not the desktop's change time.** No
  route offers a trustworthy origin timestamp, and inventing one would put a
  number in the record that nothing produced. The 253ms figure is the distance
  between those two moments on the browser route, and it is re-measured on the
  shipping path rather than quoted.

## Evidence

- `docs/proofs/can-we-subscribe-to-element-changes.md` — the browser push
  channel, the 253ms cause-to-observation measurement, shapes-never-values, and
  the attribution-not-detection finding.
- `docs/proofs/can-node-be-told-the-desktop-changed.md` — 18 ambient signals in
  a quiet 3s window; 6 of 639 traceable; attribution by sender name, never by
  matching text in a payload; two match rules and two registrations required,
  and missing either fails silently.
- `docs/02-DECISIONS/0032-the-page-layer-is-an-instrument-not-a-gate.md`,
  clause 4 — the divergence rule that had to be inverted, and clause 5, "the use
  of attribution is knowing when to yield, not when to alarm".
- `docs/08-GLOSSARY.md:43` — the three attribution values, pre-declared.
- `docs/00-PRODUCT.md:119` — "the desktop talks first", pre-declared.
- `docs/02-DECISIONS/0037-the-other-three-classes-are-on-the-wire-before-they-are-possible.md`
  — the precedent for shipping a method that refuses by name.
- `daemon/src/server.ts` — `serialised()`, the property that makes the
  attribution rule mechanical rather than statistical.

# 0076 — A field is emptied one key at a time, and then checked

**Status:** accepted
**Date:** 2026-09-04

## Context

An agent on this desk could put text into a field and could not take it out.

`typeText` (ADR-0067) emits characters at whatever holds the keyboard. Emission appends; it
has never replaced. `setElementText` is the semantic replacement, and it is refused whenever
the element publishes no editable-text interface to set — which is the case for a great many
real controls, Chromium's address bar among them. So a field that reads `google.com` and is
typed into reads `google.comduckduckgo.com`, and there is no verb that fixes it.

The obvious way out is the one a person uses: select everything, then type over it. This
contract cannot. Schema `1.12.0` removed `Control+a` and six other held-modifier names
(ADR-0067, amended) because the route taps a modifier and releases it before the key it was
meant to modify: measured, a `Control+a` sent that way selects nothing and reports success.
Shipping it back would be shipping a name that lies.

What remained was the caller doing it by hand: `Home`, then `Delete`, then `Delete`, then
`Delete`. Measured on 2026-09-04, an agent asked to search for a picture spent its entire step
budget pressing `Delete` at an address bar and never reached the search. The loop is not the
agent's to run — it is unbounded from where the agent stands, because the agent cannot see how
many characters are in the field until it reads one, and each press costs a turn.

This is a property of desks, not of the container it was measured in. Any Linux accessibility
layer has the same three facts: emission appends, held modifiers are not expressible over this
route, and many editable controls publish no editable-text interface. The workaround for the
browser *crash* that the same errand hit is environment-specific and lives in the demo's
startup script; this is not that.

## Decision

Schema `1.16.0` adds `clearElementText`. It is `rawInput`-class, like the two methods it is
built from, and it is a loop the daemon runs once instead of a loop the caller runs blind.

1. **The count comes from the element, not from the caller.** The daemon reads the element,
   takes the length of the text it publishes, presses `End`, and then presses `Backspace` once
   per character. Characters, not UTF-16 units: a surrogate pair is one press.
2. **An element whose text cannot be read is refused before any key is sent.** No count means
   no bound and no way to check the result, and an unbounded run of destructive keys aimed at a
   window this daemon cannot check afterwards is not something it will start.
3. **A text longer than `1024` characters is refused by its length, without pressing.** At that
   size the thing is a document, not a field, and one key per character is the wrong tool.
4. **The element is read back, and a field that does not read empty is a refusal.** This is
   where this verb differs from its two neighbours. `sendKeyChord` and `typeText` can only
   report that something was sent, because eleven of fourteen chords leave the element reading
   identically whether the key landed here or in another window. Clearing has an intended
   state, so the intended state is compared, and `WriteNotObservedError` names how many
   characters are still in it. Nothing here claims an emptiness nobody observed.
5. **Nothing escalates into it.** As with the other raw-input methods (ADR-0046 clause 3), the
   only edge into the daemon's clearing handler is the dispatch table. A refused
   `setElementText` does not come back as a field emptied by keystroke.

## Consequences

- An agent can replace a field's contents in two calls — clear, then type — instead of one call
  per character, and the calls it makes are honest about what they observed.
- The verb is destructive and says so: it presses real keys at whatever holds the focus. The
  read-back is the only thing standing between that and a silent mess, which is why a failed
  comparison refuses rather than warns.
- `1024` is a bound, not a measurement. It is drawn where a field stops being a field. A caller
  with a genuinely long value gets a refusal that names the number and the limit.
- The CDP and replay backends do not implement it: one drives a page that has semantic
  replacement already, the other replays exchanges it never recorded.
- Held modifiers are still absent, and this decision does not reopen them. It routes around the
  gap rather than pretending the gap is closed.

## Evidence

- `daemon/src/backends/atspi/index.ts` — `clearElementText`: read, bound, `End`, count presses,
  read back, compare.
- `daemon/src/__tests__/clearing-is-counted-and-checked.test.ts` — one press per character with
  `End` first; an emoji counted once; nothing pressed for an already-empty field; refusal
  without pressing for unreadable text and for over-long text; refusal after pressing when the
  field does not read back empty; the gates in front of the verb; no edge from a semantic verb.
- `protocol/schema.json` at `1.16.0`, and the generated descriptor's `rawInput` class.
- Measured 2026-09-04: an agent given the errand "find a picture and set it as the wallpaper"
  exhausted 24 of 24 steps clearing an address bar by hand and never searched.

## Amendment, 2026-09-04: a field that answers back gets a second pass

Measured on this desk: Chromium's address bar autocompletes a suffix back in while the
deletions are landing, so a counted pass ends short of empty through no fault of the keys — 53
Backspaces left 16 characters, and the verb refused a clear that was working. The bar publishes
no `EditableText` interface, so there is no semantic replacement to route to instead, and this
contract still has no held-modifier chord to select with.

So the verb now presses in passes rather than once. Each pass counts the element's own current
reading and presses that many times: nothing is pressed that was not counted, which is the whole
of the original decision. A pass that did not shorten the text ends the loop — a field being
refilled at least as fast as it is emptied is not being emptied, and pressing on would be the
unbounded destructive run this verb exists to refuse. Three passes is the ceiling, and the total
stays inside the same `1024` press budget; the refusal names the deletions actually spent.

- `daemon/src/backends/atspi/index.ts` — `CLEAR_MAX_PASSES`, and the loop that breaks on no
  progress.
- `daemon/src/__tests__/clearing-is-counted-and-checked.test.ts` — a field that refills once is
  emptied by the second pass; a field that refills everything is refused after the first.

## Amendment, 2026-09-05: a stalled pass is turned around before it is refused

Measured on this desk, a harder shape than the refill: Chromium's address bar autocompletes a
suffix and leaves it *selected*, and a Backspace aimed at a selection eats the selection rather
than a character. Every key landed, every key was counted, and not one character went — 999
deletions left 78 characters, and the errand stopped on a field a person empties without
thinking about it.

Deleting forwards has no selection in front of it and nothing to autocomplete ahead of it. So a
pass that made no progress is now turned around exactly once: `Home` and one `Delete` per
character, counted from the element's own reading like every other pass. A second stall, in the
other direction, still refuses — a field that survives deletion from both ends is not being
emptied by keys, and the refusal still names the deletions actually spent. The ceiling moves
from three passes to four to pay for the turnaround; the `1024` press budget does not move.

- `daemon/src/backends/atspi/index.ts` — `CLEAR_MAX_PASSES`, and the `forwards` pass.
- `daemon/src/__tests__/clearing-is-counted-and-checked.test.ts` — a field whose autocompletion
  eats every backspace is emptied by the turned-around pass; a field that refills from both ends
  is refused after it.

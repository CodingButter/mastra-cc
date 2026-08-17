# ADR-0045 — Actions are verbs; operations carry the magnitudes

**Status:** accepted
**Date:** 2026-08-17
**Extends:** [ADR-0043](0043-an-element-publishes-its-own-actions.md), which opened the action vocabulary without saying how a parameterised capability crosses the wire.

## Context

[ADR-0043](0043-an-element-publishes-its-own-actions.md) established that an element publishes its own actions and that the daemon reads them rather than inventing them. It left a question open, and the question turned out to be the load-bearing one:

> If an element publishes a `scroll` action, what does the agent pass? Pixels? A percentage? Windows, macOS and Linux cannot all mean the same thing by the same word — so does the daemon translate, or does it design one unified interface per capability and make every backend conform?

The question assumes actions can carry parameters. **Measurement says they cannot.** Introspected live off the session accessibility bus on `minibeast` (Wayland), 2026-08-17:

```
Action.GetActions(out:a(sss))
Action.DoAction(in:index:i, out:b)
Action.GetName(in:index:i, out:s)
Action.GetDescription(in:index:i, out:s)
Action.GetKeyBinding(in:index:i, out:s)
PROPS: NActions:i
```

`DoAction` takes exactly one integer: *which* action. There is no parameter channel — not a truncated one, not an awkward one. **`scroll(60%)` is structurally inexpressible as an action**, and this is not a Linux quirk: `IAccessible::accDoDefaultAction` on Windows and `AXUIElementPerformAction` on macOS have the same parameterless shape. The three platforms agree, because they all descend from the same screen-reader lineage.

Everything with a magnitude lives on a *different interface*, with real typed arguments. Also introspected live:

| Capability | Interface and signature | Units |
|---|---|---|
| Scroll, semantic | `Component.ScrollTo(type:u) → b` | an enum — top-left, anywhere, and so on |
| Scroll, mechanical | `Component.ScrollToPoint(coord_type:u, x:i, y:i) → b` | pixels, plus a coordinate-space flag |
| Magnitude | `Value` — `MinimumValue:d`, `MaximumValue:d`, `CurrentValue:d` (readwrite), `MinimumIncrement:d` | the element's own units |
| Text | `Text` / `EditableText` — offsets and granularity enums | characters |
| Geometry | `Component.SetPosition(x:i, y:i, coord_type:u) → b`, `SetSize`, `SetExtents` | pixels |

The pixels-versus-percentage worry is real, and it is worse than the question assumed: **scroll has two incompatible unit systems on a single platform.** An enum-based `ScrollTo` and a pixel-based `ScrollToPoint` are both called scrolling and share no argument shape.

But the same measurement supplies the answer. A live `Value` element found during the survey (role `level bar`) published:

```
MinimumValue = 0
MaximumValue = 1
CurrentValue = 0.9852447509765625
MinimumIncrement = 0
```

That is a **self-describing range in the element's own units**. A percentage is a *reading* of it, not a unit anyone has to impose. Windows exposes the identical concept as `IRangeValueProvider` (`Minimum`, `Maximum`, `Value`, `SmallChange`); macOS as `AXValue` with `AXMinValue` / `AXMaxValue`. The unifying abstraction already exists on all three platforms, and it is not the action interface.

One further measurement, because it changes an implementation that would otherwise look correct: the bulk `GetActions` call returns **empty name strings on some applications** — 10 of 263 action-publishing elements in the survey. Asking per index with `GetName(i)` returned the real name every time (`activate`, `doDefault`, `showContextMenu`). A daemon that trusts the bulk reply reports nameless actions and looks broken in exactly the way this milestone exists to prevent.

## Decision

**The wire carries two distinct kinds of thing. Actions are parameterless verbs read from the element. Operations are a small, deliberately designed set of neutral, typed capabilities that each backend implements in its own units.**

1. **Actions stay open, parameterless, and untranslated.** The name is read from the element and passed through under the platform's own word. `activateElement` carries an action *name* and nothing else, because the platform interface carries nothing else.

2. **Action names are never normalised into a synonym table.** Names vary across toolkits and are often semantically close — `click`, `doDefault`, `activate`. Collapsing them onto one invented word is the same error as the `ACTIONS_BY_ROLE` table this milestone deletes: a mapping we authored, presented as a measurement. Close is not the same, and a model reading three names with their descriptions is a better judge of intent than a lookup table we wrote in advance. The `GetDescription` and `GetLocalizedName` strings are carried alongside so the reader has more than the bare verb.

3. **Operations are the small designed set.** Each is a capability that genuinely needs an argument, is present on all three target platforms, and is expressed in neutral terms:
   - **set a value** — within the range the element publishes
   - **set text** — replace or insert at an offset
   - **place the caret**
   - **reveal an element** — bring it into view; the neutral form is *make this visible*, never a pixel offset

   The set is deliberately small. A new operation requires an ADR naming the equivalent interface on each platform, because an operation with one implementation is a Linux feature wearing a neutral name.

4. **A range is published, never assumed.** An element carrying a magnitude reports its minimum, maximum, current value and smallest step. The agent is never asked to guess whether a number means pixels or percent — it reads the range off the element and expresses the target in those units. Percentage is a presentation choice, computed from a published range, and no percentage is ever invented where a range is absent.

5. **Scroll is a reveal operation, not an action, and not a coordinate.** The neutral form is *bring this element into view*, which is what `Component.ScrollTo` expresses and what every platform can honour. `ScrollToPoint` and its pixel arguments stay inside the Linux backend as an implementation detail. This corrects the reasoning in ADR-0043, which recorded scroll as arriving free with published actions — it does not; measurement found zero scroll actions in a 2,497-element survey.

6. **Every action name is read per index.** `GetActions` is a hint; `GetName(index)` is the answer. Where the bulk reply and the per-index reply disagree, the per-index reply wins and the disagreement is recorded in the diagnostic subtree.

7. **An effect is verified by reading the world back, never by a return code.** Established for geometry by measurement — `SetPosition` returned `true` on a Wayland frame whose extents were identical afterwards — and it applies to every operation here. A successful return is a claim; a re-read is evidence.

## Consequences

**Good.** The porting question the milestone was stuck on becomes small. A new backend implements one seam: read published actions, plus four operations with defined neutral semantics. It does not have to invent a unit system, because the elements publish their own. The agent-facing contract stops lying about what an action is — it is a verb, and the wire now says so.

**Good.** The separation puts the invention where it belongs. Actions are pure measurement with zero authored vocabulary. Operations are authored, and *because* the set is tiny, each one can be argued about individually and given an ADR of its own.

**Cost.** The operation set is designed against one platform, so it will over-fit to Linux in ways invisible until a second backend exists — the same cost [ADR-0018](0018-the-protocol-speaks-a-neutral-element-vocabulary.md) accepted for roles and states, accepted again here for the same reason: designing against one measured platform beats designing against zero.

**Cost.** Two concepts on the wire where the schema currently implies one. A caller must know whether the thing they want is an action or an operation. The mitigation is that the element says so — it publishes its actions, and it publishes the interfaces that carry its operations — but the agent-facing surface is genuinely wider than a single `perform` call.

**Cost.** Refusing to normalise action names means the agent sees toolkit-flavoured words and must reason about them. That is a deliberate transfer of work from a table we would have written to a model that can read a description, and it will occasionally be wrong in ways a fixed table would not have been.

**Risk.** An open action name is an uncontrolled string on a wire that [ADR-0018](0018-the-protocol-speaks-a-neutral-element-vocabulary.md) requires to stay free of platform vocabulary, and boundary test B10 checks the *schema text*, not runtime values. Today's measured vocabulary happens to contain no deny-listed term; that is luck, not design. The implementing milestone must extend the check to published action names at the point they are read, or the neutral-vocabulary rule holds only for words we wrote down in advance.

**Risk.** "Reveal an element" is honoured differently by different toolkits, and a reveal that silently does nothing is the `SetPosition` failure again. The operation must verify by re-reading the element's extents, and report honestly when the position did not change.

## Evidence

| Claim | Source |
|---|---|
| `DoAction` takes an index and nothing else | live introspection of `org.a11y.atspi.Action`, minibeast Wayland, 2026-08-17: `Action.DoAction(in:index:i, out:b)`, `PROPS: NActions:i` |
| scroll has two incompatible unit systems on one platform | same introspection: `Component.ScrollTo(type:u)` vs `Component.ScrollToPoint(coord_type:u, x:i, y:i)` |
| a magnitude element publishes its own range | live `Value` element, role `level bar`: `MinimumValue=0`, `MaximumValue=1`, `CurrentValue=0.9852447509765625`, `MinimumIncrement=0` |
| no scroll action exists to be published | 2,497-element AT-SPI survey, 2026-08-16: 13 publishing actions, vocabulary `activate`, `doDefault`, `showContextMenu`, `click` — zero scroll |
| bulk action names are unreliable | 263 action-publishing elements surveyed 2026-08-17: 10 returned all-empty names from `GetActions`, `GetName(index)` returned the real name in every sampled case |
| a return code is not evidence of an effect | Wayland move/resize probe, 2026-08-16: `SetPosition` returned `true`, extents identical before and after |
| the closed four-word enum shares no word with reality | `protocol/schema.json:24` (`press`, `focus`, `select`, `expand`) vs the measured vocabulary above |
| the platform seam is inside the daemon and nowhere else | [ADR-0017](0017-platform-backends-live-inside-the-daemon.md) |
| the protocol defines its own vocabulary; the diagnostic subtree is the only exemption | [ADR-0018](0018-the-protocol-speaks-a-neutral-element-vocabulary.md), boundary test B10 |
| an element publishes its own actions | [ADR-0043](0043-an-element-publishes-its-own-actions.md) |

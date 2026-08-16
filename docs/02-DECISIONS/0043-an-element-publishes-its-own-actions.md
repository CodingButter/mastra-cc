# 0043 — An element publishes its own actions

Status: accepted, 2026-08-16 (pre-M3)

## Context

The schema has always said the right thing. `protocol/schema.json:56` describes
`semanticElement.actions` as *"what a later call could be asked to do"* — a
property **of the element**, discovered per element, with the honest note that
M1 implements none of them.

Both backends do something else. `daemon/src/backends/atspi/roles.ts:104` and
`daemon/src/backends/cdp/roles.ts:93` each implement `actionsForRole(role)`
against a hardcoded table:

| Role | Actions we assert it has |
|---|---|
| button, checkbox, link, menuitem | press, focus |
| menu | expand, focus |
| listitem | select, focus |
| textbox | focus |

Nothing ever asks the platform. Greps for `GetActions`, `GetNActions` and
`doAction` across both backends return **zero hits**. We invented a table and
shipped it as though it were a measurement — the exact shape
[ADR-0010](0010-daemon-is-python-single-threaded-default-glib-context.md) rule 5
already forbids: capabilities are *probed, never inferred*.

The cost of the invention showed up as a design question that should never have
existed. "How do we do scroll?" was treated as a missing verb needing a schema
addition, a new action enum entry, and a milestone. But AT-SPI exposes a real
`Action` interface — enumerable by name, exercised in
[can Node act on the desktop](../proofs/can-node-act-on-the-desktop.md) — and a
scrollable pane advertises its own scroll action, a slider advertises its own
verbs. Jamie put it directly:

> *"maybe scroll is just an action that comes for free by giving the agent the
> ability to perform any action an element exposes."*

It does. Scroll was never a design question. It was a question we manufactured
by guessing at a table instead of reading the tree, and it dissolves the moment
we ask the element.

The second half of the context is who decides what may be *used*. Jamie's
ruling, and it is binding on the whole capability surface:

> *"the user configures capabilities and the daemon hard enforces them. no agent
> ever decides what it's capable of doing — the daemon just flat out tells it
> what actions or capabilities the user has enabled or flat out refused."*

## Decision

**1. Actions are read from the element, never derived from its role.** Both
backends ask the platform what an element can do — AT-SPI's `Action` interface
on the accessibility route, the equivalent derivation on the browser route. The
role→action tables are deleted. Where a route cannot answer, the element reports
that it does not know, which is a different answer from *no actions* and must
not be collapsed into one.

**2. The action vocabulary is open, not enumerated.** The closed four-value
enum (`press`, `focus`, `select`, `expand`) is replaced by a vocabulary sourced
from the element. A neutral name is still mapped where a native action has a
known neutral equivalent — but an action with no mapping is **carried through
under its native name and marked as such**, never dropped. The prototype's
lesson about roles applies unchanged: a vocabulary that silently discards what
it does not recognise reports a poorer desktop than the one that is there.

**3. Three action states, never collapsed to two.** For every action, the daemon
reports exactly one of:

| State | Meaning |
|---|---|
| **available** | the element exposes it, and configuration enables it |
| **disabled-by-configuration** | the element exposes it; the user has turned it off — and the report names the setting |
| **not-exposed** | the platform does not offer it on this element |

This is [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md)'s
2026-08-08 per-application three-state amendment applied one level down, and it
inherits that amendment's rule: **the three are never collapsed into two.**
Collapsing *disabled-by-configuration* into *not-exposed* is precisely the false
belief [ADR-0042](0042-existence-is-readable-content-is-not.md) exists to
prevent, one scale smaller — the agent would conclude the desktop cannot do a
thing the desktop can do, and report a capability limit that is really a
settings toggle.

**4. Configuration is the user's; enforcement is ours.** The set of actions the
daemon will perform is a user configuration — per application and globally —
with reasonable defaults and no opinion of ours baked in beyond those defaults.
The agent never decides what it is allowed to do; it is *told*, and the telling
is backed by enforcement before the call (B11). What is **not** configurable is
the set of mechanisms that make configuration meaningful: attestation before a
`submit`, the audit log, refusals that name the check that ran, and the person
outranking the agent. A permission system with a disable switch is a permission
system that lies.

**5. An advertised action is a claim, not a guarantee.** M0.5 measured this: a
button can advertise a press and be covered by an opaque panel
([what hidden actually means](../proofs/what-hidden-actually-means.md)). The
published action list is a hint for the planner and an input to enforcement. It
is never a promise that the action will succeed, and the observed result is
still observed rather than assumed.

**6. The capability set is completed before anything is built on top of it.**
Jamie's ordering ruling:

> *"if our daemon doesn't support everything now then in my opinion we aren't
> even ready for a hub yet… if the foundations aren't laid, proven and tested
> then the constructed layers on top are doomed."*

Configuring a capability list that is not implemented is decoration. The daemon's
verb set is decided, frozen into the schema, implemented on both routes and
proven on real hardware **before** the hub is built. See
[07-ROADMAP.md](../07-ROADMAP.md).

## Consequences

**Good.** Scroll, and every other verb we had not thought of, arrives without a
schema negotiation — including verbs on applications we have never tested,
because the element is the one describing itself. The system stops asserting
capabilities it never checked. And the agent gains the context it needs to stop
flailing: an action refused by configuration is reported as such, so the working
agent reports a *reason*, the orchestrator relays a *decision*, and the orb can
tell the user which setting to change.

**Cost — an open vocabulary is harder to test than a closed one.** A fixed
four-value enum can be exhaustively asserted; a vocabulary sourced from live
applications cannot. Conformance moves from "these are the actions" to "these are
the *invariants* about actions" — every element's list came from the platform,
the three states are distinguishable, unmapped natives survive under their own
name. The offline replay lanes must carry recorded elements with real action
lists, or the tests will assert against a table we made up a second time.

**Cost — two routes, different fidelity.** The accessibility route has a real
`Action` interface. The browser route does not expose actions on accessibility
nodes; it is derivable in a single call, but it is a derivation, and derivations
drift. Per [ADR-0040](0040-a-visibility-verdict-carries-its-route.md) the answer
already carries the instrument that produced it, so the difference is visible
rather than silently averaged — but it is a difference, and the two routes will
not report identically.

**Cost — the work is larger than it looks.** Deleting `actionsForRole` changes
the schema's action enum, both backends, the conformance suite, the offline
fixtures, and every test that asserted the invented table. It is the bulk of the
milestone this ADR sits in front of, not a refactor inside one.

**Deferred.** The *shape* of the configuration surface — where the user's
capability settings live on disk, and how they compose with the grants file — is
not decided here. This record fixes where actions come from and how they are
reported, not how the user edits them.

## Evidence

| Claim | Source |
|---|---|
| the schema already describes actions as a property of the element | `protocol/schema.json:56` |
| both backends derive actions from a hardcoded role table | `daemon/src/backends/atspi/roles.ts:104`; `daemon/src/backends/cdp/roles.ts:93` |
| nothing asks the platform what an element can do | grep for `GetActions`/`GetNActions`/`doAction` across both backends: zero hits, 2026-08-16 |
| the closed action enum is exactly four values | `protocol/schema.json`, `enums.action` (press, focus, select, expand) |
| AT-SPI exposes a real, enumerable Action interface | [can Node act on the desktop](../proofs/can-node-act-on-the-desktop.md) |
| the browser route does not expose actions on a11y nodes, but they are derivable | [09-QUESTIONS.md](../09-QUESTIONS.md), "Affordances in the tree" |
| an advertised action can be unperformable | [what hidden actually means](../proofs/what-hidden-actually-means.md) |
| capabilities are probed, never inferred | [ADR-0010](0010-daemon-is-python-single-threaded-default-glib-context.md) rule 5 |
| three states are never collapsed to two | [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md), 2026-08-08 amendment |
| effect-class operations are enforced before the call | `docs/01-ARCHITECTURE.md` §5 (B11) |
| the user configures, the daemon enforces; the layer-order ruling | Jamie, 2026-08-16 |

# ADR-0047 — The wire carries words we did not invent

**Status:** accepted
**Date:** 2026-08-18
**Implements [ADR-0043](0043-an-element-publishes-its-own-actions.md) and [ADR-0045](0045-actions-are-verbs-operations-carry-magnitudes.md) on the wire. Amends [ADR-0018](0018-the-protocol-speaks-a-neutral-element-vocabulary.md) clause 2 in part. Gives [ADR-0042](0042-existence-is-readable-content-is-not.md) a method to exist in.**

## Context

The protocol shipped a closed list of four things an element could be asked to
do — `press`, `focus`, `select`, `expand` — from schema 1.0.0 through 1.3.0
(`protocol/schema.json:24` at `9dfb6cf`). The list was invented. Nobody
measured a desktop before writing it, and two hardcoded tables downstream
(`daemon/src/backends/atspi/roles.ts:94-106`,
`daemon/src/backends/cdp/roles.ts:83-94`) mapped a role to those four words,
plus a third invented answer — a literal empty list at
`daemon/src/backends/cdp/index.ts:125`.

Then the desktop was asked. A survey of **2,497 elements** on a live session
(minibeast, 2026-08-16 and re-run 2026-08-17) found elements publishing
`activate`, `doDefault`, `showContextMenu`, `click`, and `menu`. **The shipped
enum and the live vocabulary share zero words.** Not "mostly overlapping", not
"a subset needing extension" — zero. The four words were not an incomplete
model of the desktop; they were a model of nothing at all, and every element
the daemon has ever reported carried them.

That measurement is the whole reason this version exists, and it generalises
past the four words: any list of verbs written in advance is a list somebody
invented, because the verbs belong to applications nobody in this repository
wrote. The 2,497-element survey found five names; a different desktop with
different applications installed would find a different five. There is no
edition of that list that is correct everywhere, which means the correct list
is not a list.

But opening a vocabulary runs straight into [ADR-0018](0018-the-protocol-speaks-a-neutral-element-vocabulary.md)
clause 2, which declares the element vocabulary — "role, name, states,
actions, and relationships" — "a closed enumeration, versioned with the
schema". That clause is load-bearing: it is why the wire has no toolkit names
on it, enforced mechanically by pin B10's twenty-term deny-list. This record
cannot open the action vocabulary without saying exactly what happens to that
clause, or B10 becomes a rule with a hole nobody wrote down.

Separately, [ADR-0045](0045-actions-are-verbs-operations-carry-magnitudes.md)
established by introspection that an action cannot carry a parameter on any
target platform — `Action.DoAction(in index:i) -> b` is the entire input
surface, and Windows' `accDoDefaultAction` and macOS' `AXUIElementPerformAction`
share the shape. So everything with a magnitude needs somewhere else to live,
and that somewhere has to be on the wire before any backend can implement it.

And [ADR-0042](0042-existence-is-readable-content-is-not.md) reversed the
invisibility rule — an unpermitted application is present and honest about why —
but there is no method through which it could be honest. The schema carries
eight methods and none enumerates applications, and the closed `roles` list has
no application-list role, so `queryElements` cannot smuggle one.

Four pressures, one version. A schema version is a single indivisible act: the
freeze gate ([ADR-0002](0002-schema-freeze-is-a-ci-job.md)) demands a bump, an
ADR, and regenerated goldens together, so splitting these across versions would
buy three of everything and a reviewer reading a bundle its own record does not
describe.

## Decision

The wire moves to **schema version 1.4.0**, carrying four surfaces.

1. **An action's name is open text; the verdict beside it is closed.**
   `semanticElement.actions` becomes a list of records rather than a list of
   enum values. The `name` is whatever the element published, verbatim — the
   generator's closed-vocabulary table no longer contains actions at all
   (`protocol/generate.mjs`), because a name that must appear in a table we
   maintain is a name we invented. Each action also carries the platform's own
   `description` and `localizedName` where it offers them
   ([ADR-0045](0045-actions-are-verbs-operations-carry-magnitudes.md) clause 2):
   refusing to normalise `click`, `doDefault` and `activate` into one word means
   a reader needs the application's own words to tell them apart, and a fixed
   table is exactly what this version is removing.

2. **[ADR-0018](0018-the-protocol-speaks-a-neutral-element-vocabulary.md)
   clause 2 is amended in one respect and stands in every other.** Roles stay
   closed. States stay closed. Every vocabulary the *daemon* decides stays
   closed and versioned with the schema, and three new closed ones join them
   (availability, operation names, capability names). What opens is the one
   vocabulary the daemon does not decide: the names of verbs published by
   applications nobody here wrote. Clause 2's reasoning is preserved by this
   split rather than weakened by it — it exists so the protocol is not shaped
   by one platform, and a word read off an element and passed through untouched
   is not the protocol choosing a shape. The failure clause 2 names is a role
   string "copied verbatim from the accessibility layer because that is what
   the backend already had", quietly deciding the protocol's shape with nobody
   present. An action name is the opposite case: it is content, transported,
   and the fact that it came from the element is the point of carrying it.

3. **An action name can be a toolkit name, and the wire takes it anyway.** B10
   checks the schema *text* — field names, enum values, descriptions — and it
   still does, unchanged. It cannot check a runtime value, and the live
   vocabulary's freedom from all twenty deny-listed terms today is luck, not
   design: an application is free to publish an action called `gtkClick`
   tomorrow. When that happens the name is carried verbatim, because the
   alternatives are worse — dropping it makes a real affordance invisible, and
   renaming it makes a call name a verb the element will not answer to. What
   the neutrality rule protects is the *contract*: no method, field, type or
   description may name a platform, and that remains mechanically enforced. A
   value flowing through a field is not the contract. The implementing
   milestone additionally checks published names against the deny-list **at the
   point they are read** and records a hit in the diagnostic subtree, so a
   toolkit-named action is visible as a measurement instead of a surprise
   (amendment A2). That check reports; it does not rewrite.

4. **Three availability states, and collapsing any two is a lie about what is
   possible.** `available` means it can be done now. `disabled-by-configuration`
   means this machine's owner turned it off, and `disabledBy` names which
   setting. `not-exposed` means the platform never offered it, and no setting
   would change that. The validator enforces the pairing in both directions: a
   configuration-withheld thing must name its setting, and nothing else may name
   one. This is the same shape as attribution's cause id — a rule the field
   specs cannot express, enforced in code beside them. The distinction is the
   entire point of [ADR-0042](0042-existence-is-readable-content-is-not.md) at
   element scale: "turned off" is a door with a key and "never offered" is a
   wall, and an agent told the wrong one either badgers a user about a setting
   that does not exist or gives up on something one toggle away.

5. **Four operations carry the magnitudes, as their own methods.** `setElementValue`,
   `setElementText`, `setElementCaret` and `revealElement` join the wire with
   typed arguments, per [ADR-0045](0045-actions-are-verbs-operations-carry-magnitudes.md)
   clause 3. Where an element publishes bounds for a magnitude it publishes them
   as a `range` — `minimum`, `maximum`, `current`, and `step` when it declares
   one — and a magnitude is expressed in those units. **Where no range is
   published, no percentage is computed anywhere**: percent is a reading of a
   published range, never a unit imposed by the daemon (clause 4). They are
   methods rather than fields because the daemon answers a method with a
   refusal that names its own check, and the operations are refused by name
   until segment 2 implements them — the same defined-and-refused shape schema
   1.2.0 used for the three effect verbs ([ADR-0037](0037-the-other-three-classes-are-on-the-wire-before-they-are-possible.md)).

6. **Scroll is the reveal operation, and it carries no distance.** `revealElement`
   says *make this visible* and nothing else. It is not an action — a survey of
   2,497 elements found zero scroll actions, because scroll does not live on the
   action interface at all — and it carries no coordinate, because the same
   platform offers two incompatible unit systems for it (an enum of positions,
   and pixels), and a wire that picked either would be picking one machine's
   geometry. Which of them satisfies a reveal is the backend's business. This
   corrects [ADR-0043](0043-an-element-publishes-its-own-actions.md)'s claim
   that scroll arrives free with published actions; it does not.

7. **The application listing gets a method.** `listApplications` returns every
   installed application with its per-capability availability and the setting
   behind each refusal — the surface
   [ADR-0042](0042-existence-is-readable-content-is-not.md) requires and could
   not previously have. Its result shape names no mechanism: an application has
   a name, a set of capability verdicts, and whether this daemon knows how to
   start it. Discovering the inventory is a platform question answered below the
   seam ([ADR-0017](0017-platform-backends-live-inside-the-daemon.md), amendment
   A1) — desktop entries are one operating system's answer, and a wire that
   named them would have exported a Linux concept as a contract. It is
   observe-class, and it reads the fence rather than anything behind it:
   existence and permission are readable, content is not.

8. **Portability posture, stated rather than assumed** (amendment A2). The wire
   stays OS-neutral by construction — [ADR-0018](0018-the-protocol-speaks-a-neutral-element-vocabulary.md)
   plus B10 — and only Linux is implemented before M6, by
   [ADR-0017](0017-platform-backends-live-inside-the-daemon.md). This version
   buys the seam, not the ports. Every Linux-shaped answer underneath it is
   recorded as Linux-shaped, so a second backend inherits a contract rather than
   an archaeology problem.

## Consequences

**The cost, first.** An open vocabulary means the wire can carry a word nobody
reviewed. A closed enum makes an unknown value a validation failure at the
boundary; an open name makes it a fact the reader has to interpret. That is a
real loss of a real defence, and it is accepted on the grounds that the defence
was protecting an invention: rejecting `click` because it was not in a list of
four words we made up is not safety, it is a machine enforcing our own error.

Type safety narrows with it. `ActionName` was a union of four string literals;
downstream code could switch on it exhaustively and the compiler would check
the switch. It is now a string, and code that wants to branch on an action must
handle a name it has never seen. That is honest about the domain — the desktop
was always going to publish a verb we had not planned for — but the compiler
stops helping at exactly the point it used to.

**A closed list of open things.** The operations are a designed, fixed set of
four while the actions beside them are unbounded, and that asymmetry will look
arbitrary to someone reading the schema cold. It is deliberate: actions are
read off elements, so the desktop decides them, while operations are ours to
implement on every platform, so each new one is a promise to implement it
everywhere. [ADR-0045](0045-actions-are-verbs-operations-carry-magnitudes.md)
requires an ADR naming the equivalent interface on each platform before a fifth
operation is added, precisely because an operation with one implementation is a
Linux feature wearing a neutral name.

**Two surfaces ship defined and unimplemented.** The operations and the listing
are on the wire and refused by name — segment 2 implements the first, segment 3
the second. This repeats schema 1.2.0's pattern deliberately, and it repeats its
cost: a method that answers only with a refusal is a promise, and a promise is
not a feature. What it buys is that a client can ask and hear a refusal naming
the check that ran, rather than "not a method of the schema", which cannot
distinguish *not built yet* from *hidden*.

*Amended, M2.7 segment 1:* the operations are now routed to the seam and are no
longer one of those two surfaces. The cost above was paid in full and is worth
recording: all three backends implemented the operations before any wire method
reached them, so for the length of a segment the schema said one thing, the
seam did another, and nothing in the suite compared them — the promise outlived
the reason it was made, and the refusal sentences went on describing a daemon
that had stopped existing. What closed the gap was naming each method in
[B11](../05-TEST-STRATEGY.md) and driving all seven through the listing's
agreement test, so a method that answers with a constant is now a failing test
rather than a paragraph nobody re-read. The listing remains defined and
unimplemented until segment 3.

**Every element grows.** An element now carries an entry for each operation
including the ones it does not support, and each action carries up to five
fields where it once carried a bare string. Elements are read in bulk during a
tree walk, so this is real weight on the common path. Absence-as-a-reading is
worth paying for — an operation that is silently missing is indistinguishable
from one nobody asked about — but the walk got heavier and a later milestone may
have to measure it.

**The invented tables must now go.** This version makes the two `actionsForRole`
tables and the hardcoded empty list unreachable as correct implementations, but
it does not delete them; the readers in Phases 2 and 3 do — as they since have,
on this branch. Between this commit
and those, the wire permits a vocabulary no backend emits. That gap is
deliberate and one phase long: the alternative order — readers first — reds the
offline suite, because the generated validator enforces the closed enum at
runtime and the conformance suite validates elements from every registered
backend, replay included.

## Evidence

| Claim | Receipt |
|---|---|
| The shipped enum and the live vocabulary share zero words | `press/focus/select/expand` (`protocol/schema.json:24` at `9dfb6cf`) versus `activate`, `doDefault`, `showContextMenu`, `click`, `menu` — the execution probe, asking `Action.GetActions` on 2,497 elements on minibeast, 55 publishing, 2026-08-17. An earlier draft-time probe of the same desktop asked `Properties.Get(NActions)` instead and found 13 publishing and four names; the counts differ because the question and the open-window population differed, and the vocabulary is a superset either way. Counts are a census of one moment; the names are the finding |
| The invented tables and the third invented answer | `daemon/src/backends/atspi/roles.ts:94-106`, `daemon/src/backends/cdp/roles.ts:83-94`, `daemon/src/backends/cdp/index.ts:125` |
| An action cannot carry a parameter | `Action.DoAction(in index:i) -> b`, `PROPS: NActions:i`, introspected live; `IAccessible::accDoDefaultAction` and `AXUIElementPerformAction` share the shape ([ADR-0045](0045-actions-are-verbs-operations-carry-magnitudes.md)) |
| Bulk action names are unreliable, so names are read per index | the execution probe: of 55 publishing elements, 10 returned an all-blank name from bulk `GetActions` while `GetName(index)` named them, and the remaining 45 returned the *display* form (`Click`) where the per-index name was the real word (`click`) — the two answers disagree in every publishing case, 2026-08-17. A draft-time survey of 263 action-publishing elements reported the same blank-name failure; that is a different walk on a different population, cited here as corroboration and not as the same number |
| A magnitude element publishes its own range | a live `level bar` reporting `MinimumValue=0`, `MaximumValue=1`, `CurrentValue=0.9852447509765625`, `MinimumIncrement=0` |
| Scroll is not an action | zero scroll actions across 2,497 elements; the action interface carries `GetDescription/GetName/GetLocalizedName/GetKeyBinding/GetActions/DoAction` and nothing else |
| Two incompatible unit systems for scroll on one platform | an enum of positions versus a pixel coordinate pair, both live on the component interface, introspected 2026-08-17 |
| The listing had no wire representation | eight methods in `protocol/schema.json` at `9dfb6cf`, none enumerating applications; the closed `roles` list has no application-list role |
| The real inventory is not the launch catalog | a desktop-entry scan honouring precedence found 127 entries, 57 user-visible, including applications with no launch recipe; `daemon/src/launch/recipes.ts` knows four keys and answers "can we launch it", never "is it installed" |
| The freeze gate demands this record by name | `tools/freeze-gate.mjs` greps for the literal `schema version 1.4.0`; convention is one ADR per version (0033→1.0.0, 0034→1.1.0, 0037→1.2.0, 0039→1.3.0) |
| Readers-first would red the offline suite | the generated validator enforces closed vocabularies at runtime; `daemon/src/__tests__/backend-conformance.test.ts:46-52` validates elements from every registered backend, and replay is not live-gated (`daemon/src/backends/registry.ts:48`) |

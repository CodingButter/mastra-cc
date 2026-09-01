# 0063 — Running is a fact about the desk, not a permission

**Status:** accepted
**Date:** 2026-09-01
**Introduces protocol schema version 1.7.0 and amends [ADR-0042](0042-existence-is-readable-content-is-not.md) clause 1.**

## Context

`listApplications` could say what a machine has and never what it is doing. Every entry
carried a name, a `launchable` flag and one `capability` per capability the contract
defines, and `installedApplication`'s own description said so: *"Existence and permission are
readable; content is not."* An agent asking whether an editor was already open had no answer
in the reply and two bad options — launch a second copy of something already on screen, or
read an empty query result as an absent application. Issue #53 filed it from the other end,
and the desktop-literacy sweep (PR #73) produced transcripts of agents doing exactly that.

The obvious implementation was a boolean, and it is wrong twice.

It is wrong once because a boolean cannot carry ignorance. The browser route dials one
debugging endpoint and has no view of anything else on the machine; a boolean would make it
report the rest of the desktop closed. It is wrong twice because of the observe grant: a
session with no grant for an application cannot look at it, and `false` would turn a fact
about *permission* into a false claim about *the desk*.

The other obvious implementation — reuse `availabilityState`, which already carries three
states and names the setting behind the middle one — is wrong for a subtler reason.
`schema.json` defines availability strictly as whether **this session may perform a
capability**. Whether an application is running is neither a permission nor a capability.
Reusing the type would tell an operator to change a setting in order to make an application
start running, which is precisely the false belief the availability doctrine exists to
prevent.

## Decision

**This is schema version 1.7.0: it adds a three-state `running` field to `installedApplication`, with its
own vocabulary, governed by the grants file and by no new capability.**

Five things this commits to:

1. **A new closed vocabulary, `runningState`: `observable`, `not-answering`,
   `cannot-tell`.** It borrows availability's *shape* — three states, and a named setting on
   the middle-ish case — and not its type. `runningUnknownBy` is present exactly when the
   state is `cannot-tell`, naming the setting a person would change to be told.

2. **The field is required on every entry.** A silently absent field would be read as a no,
   which is the collapse the three states exist to prevent.

3. **The word measured is *observable*, not *running*.** The daemon asks the accessibility
   bus which applications are answering. It does not read the process table, and a name it
   reports as `observable` is one an agent can actually act on — which is the fact worth
   having. An application alive but publishing nothing is not `observable`, and that is the
   honest answer to the question a caller is really asking.

4. **Backends answer with a census, not a list.** `RunningCensus` (`daemon/src/backend.ts`)
   pairs the names a route sees with the horizon it can speak about: `every-application` for
   the desktop route, which enumerates the bus top level so absence is a measurement, and a
   name set for the browser route, which speaks about one endpoint and stays silent about
   the rest of the machine. `runningStateOf()` is the single reader of that relationship.

5. **No new capability.** Running-ness is observe-class, and observe already has exactly one
   setting — the grants file. `CONFIGURABLE_CAPABILITIES` is unchanged, and a capabilities
   file naming `observe` is still refused by name. The daemon filters the census by the
   session's grants at the server, not in the backend: filtering inside the backend would
   report an ungranted application as `not-answering`, which is the false belief again, one
   layer down.

## The amendment to ADR-0042 clause 1

ADR-0042 clause 1 reads: *"The daemon may report that an application is installed, **and whether
it is running**, regardless of what the user has permitted."* That sentence was written pre-M3,
when nothing in the daemon could answer the running half at all — it named an intent, not a
mechanism.

The mechanism turns out to matter. Installed-ness is read off the filesystem, from outside every
application. Running-ness is read off the **accessibility bus**: the daemon asks the desk which
applications are answering it, which is the same instrument clause 3 puts behind the grant. An
ungranted application's running-state is a smaller fact than its window titles, but it is a fact
of the same kind and from the same place, and "it is answering right now" is exactly the signal a
caller would use to infer that a person is sitting in front of an application they were not
permitted to watch.

So clause 1 is amended: **existence is readable regardless of permission; whether it is answering
is observe-class.** The reversal ADR-0042 exists for is preserved intact — an ungranted
application is still PRESENT in the listing, with every capability reported and every refusal
naming its setting, and now with a running-state that says *cannot-tell* and names the grants
file. The agent still learns permission rather than absence. What it does not learn, until a
person grants it, is what the desk is doing.

The cost of the amendment: an agent cannot avoid launching a second copy of an application it was
never permitted to observe. That is the right trade — it can see the application exists, it can
see that observe is off, and it can see which file would change that.

## The words were chosen twice

The states were first spelled `observable` / `not-observable` / `cannot-tell`, matching issue #53's
"observable right now". The live proof killed that spelling: with the daemon answering correctly,
the model still reported UNKNOWN about a closed editor, because *not-observable* reads as **I could
not observe it** - ignorance - rather than **it is not there**. A three-state design whose whole
purpose is keeping ignorance separable from a no had merged them again in its own vocabulary. The
states are `answering` / `not-answering` / `cannot-tell`, and the same model on the same desk then
said NOT-RUNNING. Evidence: [docs/proofs/01-what-is-running.md](../proofs/01-what-is-running.md).

## Consequences

Schema version moves `1.6.1` → `1.7.0`. The change is **additive**: no field was removed,
renamed or retyped, and no existing field's meaning changed. `installedApplication`'s
description was revised in the same commit, because this repo treats those descriptions as
normative prose — leaving *"Existence and permission are readable"* in place would make the
schema lie about itself.

Older clients are not silently broken and are not silently served either: the socket's hello
carries the schema digest, so a client built against `1.6.1` is refused at the handshake
rather than handed a reply shaped differently from the one it expects. A client that wants
the new field regenerates its bindings; a client that does not care about running-ness still
has to, because the digest is the whole reply's identity and not a per-field negotiation.
That is the trade the freeze makes deliberately, and it is why the version bump goes through
the freeze gate rather than around it.

The cost accepted: one more bus enumeration per `listApplications` call on the desktop route.
It reads names at the top level only and never descends, which is the cheapest question the
bus answers.

## Alternatives rejected

**A boolean `running`.** Cannot carry ignorance; makes a route with no view report the desk
closed, and makes an ungranted application look absent.

**Reuse `availabilityState`.** Would direct an operator to a setting that cannot change the
answer. Availability is about permission; this is about the desk.

**A new `running` capability, configurable and default-off.** Would create the second setting
governing observe that `capabilities.ts` was written to prevent, and would let an operator
withhold running-state while leaving the far more revealing element reads switched on.

**Read `/proc` or `ps`.** Answers a different question. Process liveness does not tell an
agent whether it can act on an application, and it would put a second, platform-specific
instrument behind a field the accessibility route already answers.

# 0066 — A key is raw input, even when it is addressed to one element

**Status:** accepted
**Date:** 2026-09-01
**Introduces protocol schema version 1.10.0.**

## Context

ADR-0046 defined raw input as a separate operation class and scheduled it after the
semantic route had been proven. That condition has now been met, and the same evidence
says what semantics cannot reach.

The desktop-literacy sweep (PR #73) asked a real model to run six errands on a real
desktop, three times each, before and after the instructions were rewritten. Renaming a
file in Dolphin scored zero out of three on both sides. Not because the agent could not
find the control — it found it, opened the inline rename field, and wrote the new name.
Dolphin commits that rename on Enter, and no shipped operation can press Enter. The agent
tried `submitElement`, which was correctly refused as ambiguous: submit is a commitment
about a form, not a keystroke.

So the gap is real and measured. The question this decision answers is what a key *is*,
because there is a tempting wrong answer available: address the key to an element, and
call it an element operation like any other.

## Decision

**This is schema version 1.10.0: it adds the `rawInput` capability name.** The operation
that spends it arrives in the next schema version, under its own decision record,
deliberately after the authority that governs it.

1. **Targeting an element does not make a synthesised keystroke semantic.** The four
   neutral operations describe *what an element is for* — set its value, set its text,
   place its caret, reveal it — and every one is answered by the element itself. A key is
   different in kind: it is delivered to whatever the machine is currently pointing at,
   and the element is how we aim, not what we ask. Measured directly during this segment's
   spike: the delivery route is the element's own published focus action, followed by a
   key emitted on the accessibility registry — a machine-scoped event. Calling that a
   fifth operation would put a global effect behind a per-element name, and every reader
   of the contract would draw the wrong boundary.

2. **So it is a capability of its own, `rawInput`, and it is off.** Off comes from the
   place off already comes from: `--allow` builds an empty set when the flag is absent, so
   a daemon nobody armed holds no raw-input authority without anything being carved out
   for it. It is additionally in `CONFIGURABLE_CAPABILITIES`, so an operator can withhold
   it by name from a session that was otherwise given it. Those are two independent
   settings and the refusal names whichever one is responsible — the session flag or the
   capabilities file — because a caller told to edit a file that was never the problem
   learns nothing.

3. **Nothing the agent controls can switch it on.** No tool argument, no request field, no
   configuration value written from inside a session. ADR-0046 clause 2 stands unchanged:
   the agent's only move is to ask a person. A capability the holder can grant itself is
   not a capability, it is a formality.

4. **It is never a fallback.** ADR-0046 clause 3, restated because this is the commit that
   makes it possible to violate: no failed semantic operation may retry as a synthesised
   keystroke. There is no code path to key delivery except a caller explicitly asking for
   one. A daemon that quietly types when `activateElement` fails would make every
   attestation in the log a guess about what actually happened.

5. **The capability is added before the operation exists.** This schema version ships an
   authority that governs nothing. That ordering is the point: the switch is proven off,
   under test, before the thing it switches is built. The alternative — ship the key and
   the guard together — means the first time anyone observes the guard working is also the
   first time a machine could have been typed on.

## Consequences

Older clients are unaffected by this version: no method, type, or field they send or read
has changed. A client built against 1.9.0 refuses the connection on the schema digest, as
every version does; when rebuilt, the only difference it observes is a sixth entry in the
per-application `capabilities` list, reported off with its setting named — which is
exactly what `installedApplication.capabilities` already promises, one entry per
capability the contract defines, always all of them.

An operator who wants a key pressed must say so twice over: start the daemon with
`--allow rawInput`, and not withhold it in the capabilities file. Neither is reachable
from inside a session.

Amends nothing. Implements ADR-0046 clauses 2, 3 and 4, which were accepted and
unimplemented.

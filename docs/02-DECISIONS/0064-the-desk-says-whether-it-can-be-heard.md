# 0064 — The desk says whether it can be heard

**Status:** accepted
**Date:** 2026-09-01
**Introduces protocol schema version 1.8.0.**

## Context

Every observation this contract offers travels through the machine's accessibility layer.
When that layer is switched off, the daemon does not fail: it succeeds, and returns
nothing. A desktop with six applications open reads exactly like a machine with none, and
an agent that believes the second one is not confused, it is confidently wrong — it will
launch a second copy of an editor already on screen, or report to a person that their
machine is empty.

The daemon knew this state internally and could not say it. There was no way for an
operator to ask "can you hear this machine at all", and no way for a caller to
distinguish a silent desk from a bare one. That is the same false belief
`availabilityState` and `runningState` were each shaped to prevent, arriving through a
third door.

The second question is who may switch it on. Enabling the accessibility layer
reconfigures the operator's machine — not an application's contents. It is not a fact
about Kate, so it is not a capability: `installedApplication.capabilities` carries one
entry per capability the contract defines, and a machine-scoped authority listed there
would report "may this daemon reconfigure the machine" once per installed application,
which is a category error.

## Decision

**This is schema version 1.8.0: it adds `describeAccessibility` and `acquireAccessibility`,
and a three-state `accessibilityLayer` type with its own vocabulary.**

1. **A new closed vocabulary, `accessibilityState`: `enabled`, `disabled`, `cannot-tell`.**
   Three states for the same reason availability has three. `disabled` is a fact about the
   machine and an operator can act on it. `cannot-tell` is a fact about this daemon's view,
   and a reader told `disabled` when `cannot-tell` is true goes and switches on something
   that was never off. A `reason` accompanies `cannot-tell` exactly, and never accompanies a
   measurement.

2. **Describing is observation of the instrument, not of the desk.** `describeAccessibility`
   reports the daemon's own channel and never anything an application published, so it needs
   no grant and reveals nothing about what is installed or running.

3. **Acquiring is off unless the operator started the daemon with the flag.** No request an
   agent can make turns that flag on. A session cannot grant itself authority to reconfigure
   the machine it runs on.

4. **The flag is the setting, not a capability.** It is named as an exported constant in the
   shape of `OBSERVE_SETTING`, which exists for the identical reason: an authority with
   exactly one setting, scoped to something other than one application. A capabilities file
   naming `acquire` fails startup, because it is not a capability name.

5. **Refusals keep the standing vocabulary.** Withheld by the operator reports
   `disabled-by-configuration` and names the flag. A platform this build has no adapter for
   reports `not-exposed`, because no setting would change that answer.

6. **Acquire reports what it re-read, never what it asked for.** The returned state is
   measured after the attempt. An acquire that reports success without re-reading is
   reporting its own intention.

## Consequences

Callers built against 1.7.0 keep working: both methods are additive, and no existing type,
field or refusal changed shape. A 1.7.0 client cannot call them — the socket's schema-digest
key already prevents a mismatched client connecting — and a 1.8.0 client talking to an older
daemon receives the standard unknown-method refusal.

The daemon now has a platform seam it did not have: reporting and acquiring are asked of a
platform adapter, with Linux/AT-SPI behind it and every other platform answering
`not-exposed` honestly rather than pretending. That is the seam the second-platform work
needs, arriving early because this is the first question whose answer is genuinely
per-platform.

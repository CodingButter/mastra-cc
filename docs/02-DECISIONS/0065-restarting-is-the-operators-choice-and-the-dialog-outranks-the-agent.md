# 0065 — Restarting is the operator's choice, and the dialog outranks the agent

**Status:** accepted
**Date:** 2026-09-01
**Introduces protocol schema version 1.9.0.**

## Context

The daemon's answer to "this application is wedged, restart it" was one sentence:
`that application is already running and was not opened by this daemon - launching a
second copy is refused; the running copy must be closed first` (`daemon/src/server.ts`).
Closed first *by a person*. The only place this daemon has ever ended a process is
`terminateOwned()`, which sends `SIGTERM` to what it launched, at its own shutdown, and
nowhere else.

That refusal is right as a default and wrong as the only answer. A wedged editor, a stale
profile, an operator sitting at the screen who simply wants the thing restarted — these
are real, and the daemon could not express them at any authority level. "Never" is not a
policy an operator chose; it is a policy they were given.

The obvious implementation is the dangerous one. An application asked to close often does
not close: it puts up a dialog saying there is unsaved work. Anything that gets past that
dialog — clicking its discard button, escalating to a kill, waiting it out and killing
anyway — destroys work the person did not agree to lose. A restart feature is a data-loss
feature with a timer on it unless that case is decided first.

## Decision

**This is schema version 1.9.0: it adds `restartApplication`, whose result can report an
application that came back, an element that blocked the close, or a refusal that names its
setting.**

1. **Four levels, chosen by the operator, per application and globally.** `refuse` (this
   daemon restarts nothing), `ask` (refused, and the refusal names the levels that would
   act, so a person can authorise it), `graceful` (ask the application to close, and take
   no for an answer), `force` (close it and start it again). The section is `"restart"` in
   the capabilities file, with a `default` and per-application overrides, names NFKC-
   normalised at load like every other name in that file.

2. **The default is `refuse`, which is today's behavior.** A daemon started without a
   configuration file behaves exactly as it did before this decision. Every acting level is
   something an operator wrote down.

3. **It is not a capability, and does not live in `CONFIGURABLE_CAPABILITIES`.** Those are
   booleans answering "may this session do this to this application", and the capability
   blocks refuse any other key by name at load. A boolean cannot distinguish "ask the
   application" from "take it down", and those two are not the same permission. So restart
   authority gets its own sibling section and its own named setting, in the shape of
   `OBSERVE_SETTING` (ADR-0043 clause 4's discipline, not its container).

4. **An application's unsaved-work dialog outranks the agent, and outranks this daemon.**
   At the `graceful` level, if the application puts something up instead of closing, that
   element is reported as `blockedBy`, the application is left running, and the restart is
   refused. The daemon does not dismiss it, activate it, click through it, or escalate to
   `force`. This is the feature, not a failure mode: the person who has unsaved work is the
   one whose answer counts.

5. **The outcome is read back from the desktop, never taken from an exit status.** A
   process that exited is not an application that closed, and a signal that was delivered
   is not a window that went away. What the result reports is what was observed afterwards
   — the same rule every effect in this contract already follows.

6. **A restart that cannot be confirmed is reported as unconfirmed.** If the bounded wait
   elapses and the application is neither gone nor visibly blocked, the daemon says so and
   leaves it running. Nothing escalates because a timer expired.

7. **Every restart is audited with its level and its outcome.** Ending a program on the
   operator's machine is the least deniable thing this daemon does, and it is attributable
   whether it worked, was withheld, or was refused by the application itself (ADR-0026).

## Consequences

An operator can now get a wedged application restarted without a shell. They can also
configure `force`, which will end a program without asking — that is the point of writing
it down, and it cannot be reached any other way. No agent can widen this: nothing a session
sends changes which level is in force.

`graceful` will sometimes fail, and that is correct behavior rather than a rough edge. An
application that always refuses to close is an application with something to save, and the
answer is to show the person the dialog, which is what `blockedBy` is for.

Older clients are unaffected: `restartApplication` is a new method, and every existing
method's parameters and results are unchanged. A client built against 1.8.0 that never
calls it behaves identically; the socket's schema-digest key still prevents a client from
connecting to a daemon whose contract it does not share.

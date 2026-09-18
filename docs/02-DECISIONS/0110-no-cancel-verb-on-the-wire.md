# ADR-0110: No cancel verb on the wire; the connection is the cancellation

Date: 2026-09-17
Status: Accepted — CC-09 cancellation scope. No schema change.

## The question

Cancellation today is owned by the driver connection: closing it is the request, the daemon stops the running effect at its next supported boundary, and ownership retires there (ADR-0107 and `cc09/cancellation/`). The obvious missing piece is a protocol method — *stop request 4* — that cancels one request while keeping the connection, its watches and its lease.

## What was measured

Two things had to be true for such a verb to be worth a method, and both were tested against a real socket rather than argued (`cancellation-is-acknowledged-at-a-boundary.test.ts`).

**Would it arrive in time?** Partly. Requests are dispatched without awaiting the previous one, so a second line on the same connection *is* read while an effect runs. But every request then enters the global serialisation gate, so its answer waits for the effect to finish: a cancel verb routed like every other method would be answered only after the thing it meant to cancel had ended. To work at all it would have to be handled ahead of that gate — a second exception to the rule that the desk does one thing at a time, in the one place where that rule is load-bearing.

**Would it stop anything sooner?** No. An effect stops at its next boundary and not before, because a boundary is the only point where nothing is in flight and stopping loses nothing. A key already handed to the registry cannot be retracted — by any verb, by anyone. So a cancel verb reaches exactly the boundary that closing the connection already reaches.

## Decision

No cancel verb. The connection is the unit of cancellation.

What that costs is real and is stated rather than hidden: cancelling means losing the connection, and with it that driver's watches and lease. A caller that wants to stop one effect and keep observing must reconnect and re-subscribe.

What the verb would have bought is the reverse: it would preserve the connection, while creating a method whose name promises more control than the desk can give. "Cancel" reads as "make it not have happened", and half the emitted keystrokes would already be in the document. A method that cannot mean what its name says is worse than an absence a caller can look up.

## If it is revisited

The case that would justify it is a long-lived driver with expensive watch state, cancelling frequently. The design then needs, in this order: a pre-gate dispatch path for the verb alone, a result that reports what was already emitted (the boundary error's numbers, not a boolean), and a name that does not promise retraction. Recorded in `FOLLOWUPS.md` as a scope boundary, not as missing work.

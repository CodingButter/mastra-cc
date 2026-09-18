# CC-02 unanswered: a reply that never comes

`PROOF: GREEN`

The transport bounds its handshake — a daemon that never says hello fails after
ten seconds. Past the handshake there was no budget at all. A request written to
a perfectly healthy socket that the daemon never answers left its promise
pending forever: the agent loop stopped mid-task, holding a desk it would never
hear from again, and nothing noticed, because nothing was watching.

## What the demo runs

A daemon that says hello, receives requests, and answers only `queryElements`.
Everything else it simply holds. The socket stays open and healthy throughout,
which is the whole difficulty: there is no failure here to detect.

```
no budget: request settled after 500ms? false
budget 150ms: gave up after 151ms as UnansweredRequestError
  message: transport: typeText was sent and not answered within 150ms - the connection is
  still open and the daemon has not refused, so whether it was performed is UNKNOWN. Look
  at the desk before acting again, and do not resend: a resend of an effect that did land
  is a second effect
  the same connection still answers: {"elements":[]}
```

## The three decisions in that output

**No default budget.** A desk operation has no length this transport knows —
launching an application, typing a paragraph, a modal dialog waiting on a
person. A default would turn "slow" into "unknown" on a desk that was working
perfectly. Unbounded waiting stays the contract unless a caller chooses
otherwise.

**Unknown, not failed.** The daemon never refused, and an effect that was sent
may have landed. A caller told "failed" resends — and a resend of an effect that
did land is the duplicate keystroke the [adapter retry proof](../adapter-retry/README.md)
spent its evidence preventing. The wording is pinned by a test and by the
mutation `an-unanswered-request-is-called-a-failure`.

**One request's budget, not the line's.** The connection is not terminated: the
last line of the transcript is the same client answering normally straight
afterwards.

## What it does not claim

- It does not detect a hung daemon. An expired budget says this request was not
  answered in time and nothing about why.
- It does not make an uncertain effect certain. Re-observation is still the only
  thing that does that.
- Closing the connection also settles a pending request. That is the terminal
  path and the caller's own act, not the transport giving up.

## Running it

```
node docs/proofs/reliability-remediation/cc02/unanswered/demo.mjs [checkout]
```

Transcript in `with.txt`; decision record
[ADR-0109](../../../../02-DECISIONS/0109-an-unanswered-request-has-an-unknown-outcome.md).
Pinned by `packages/transport/src/__tests__/a-reply-that-never-comes.test.ts`.

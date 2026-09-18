# ADR-0109: An unanswered request has an unknown outcome, and no default budget

Date: 2026-09-17
Status: Accepted — CC-02 bounded wait. No schema change; a transport-local option.

## Evidence

The transport bounds its startup: a daemon that never says hello fails after ten seconds with a message naming the peer. Past the handshake there was no budget at all. A request written to a healthy socket that the daemon never answers leaves its promise pending forever — the agent loop stops mid-task, holding a desk it will never hear from again, and nothing anywhere notices, because nothing was watching.

The remediation plan names this under CC-02 alongside the duplication work, and it is the opposite failure: not an effect sent twice, but a caller that cannot tell whether it was sent at all.

## Decision

`connect` takes an optional `replyBudgetMs`. When a request outlives it, that request rejects with `UnansweredRequestError`.

**There is no default.** A desk operation has no length this transport knows: launching an application, typing a paragraph, and a modal dialog waiting on a human are all legitimately slow. A default budget would convert "slow" into "unknown" on a desk that was working perfectly, and it would do so most often to the operations that matter most. Unbounded waiting remains the contract for a caller who does not choose otherwise.

**The outcome is unknown, not failed.** The line is open and the daemon has not refused; an effect request may well have been performed. `UnansweredRequestError` says so in those words and tells the caller to observe the desk and not resend. This is not decoration — a caller told "failed" resends, and a resend of an effect that did land is the duplicate keystroke CC-02 spent its evidence preventing. The wording is pinned by a test and a mutation.

**The budget is one request's, not the line's.** A request that gives up does not terminate the connection: other requests have their own budgets, and the socket is healthy by assumption. The abandoned id is dropped so a late answer is discarded rather than resolving a promise the caller was already told nothing about.

## What this does not claim

- It does not detect a hung daemon. A budget expiring says this request was not answered in time; it says nothing about why, and a caller that wants liveness must ask the desk something it knows the answer to.
- It does not make effects retryable. Nothing here makes an uncertain effect certain — that is what re-observation is for.
- Dropping the pending entry on expiry is memory hygiene with no behaviour visible through the client, so no mutation covers it: a late answer to an abandoned request settles nothing either way, and a test asserting otherwise would be asserting an implementation detail it cannot see.

## Consequences

- Added: `replyBudgetMs` on `connect` in `@mastra-cc/transport` and `@mastra-cc/desktop`, plus `UnansweredRequestError` and `isUnansweredRequestError`. No protocol or schema change; the daemon is unaware of any of it.
- A caller that sets a budget must be prepared for an unknown outcome on every effect it sends, which is strictly more work than waiting forever. That is the cost, and it is why the budget is opt-in.
- Pinned by `packages/transport/src/__tests__/a-reply-that-never-comes.test.ts` against a daemon that holds requests without answering, and by the mutations `the-budget-becomes-everyones-default` and `an-unanswered-request-is-called-a-failure`.

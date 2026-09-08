# CC-08 — bounded server subscription initialization

## Scope

The audit found that `SubscriptionBook.subscribe` discarded backend callbacks emitted before `subscribeElement` resolved, even though its comment promised delivery. The repaired server retains up to 256 initialization pointers and flushes them through the existing visibility/attribution seam after registration. A 257th pointer refuses initialization and awaits backend closure instead of silently accepting incomplete coverage. Connection teardown is terminal: a late-resolving backend subscription is closed, never installed or flushed.

This is public server-dispatch and controlled-backend proof, not a native application, transport ordering, complete structural coverage, human takeover, or cancellation-acknowledgement claim. Existing ended-watch tombstones remain until explicit unsubscribe, preserving `ended: false`; they are not reactivated by subsequent buffered changes. A rejected backend close becomes a public refusal and does not register a watch, but does **not** prove the native resource was released.

## Verification

- `red.txt.gz`: two initial public-dispatch regressions fail against unchanged baseline `3ae6a36`: early changes disappear, and overflow incorrectly succeeds.
- `green.txt.gz`: seven final regressions pass: delivery, exact 256 boundary, deferred connection close, hidden application, buffered terminal event, cleanup rejection, and overflow refusal.
- `gates-first-failure.txt.gz`: preserve the failed full run. The unchanged real-timer graceful-window test expected the Find/Replace dialog to disappear and observed it still present. This failure is outside subscription initialization; it is not erased or counted GREEN.
- `window-rerun.txt.gz`: that test file passes separately without edits.
- `gates.txt.gz`: subsequent forced build/lint/typecheck/test passes all 19 tasks without changing that timer test. A single rerun does not establish that timing flakiness has been repaired.
- `mutations.txt.gz`: final full deletion-mutation sweep: **258 mutations, none survived**, including dropped initialization delivery, accepted overflow, and ignored connection teardown.

Two independent review rounds found the connection-close race, now covered and repaired. The suggestion to delete ended-watch tombstones was rejected because it conflicts with existing unsubscribe behavior. One reviewer counted six tests; source inspection and the retained runner receipt establish seven. Review suggestions for distinct-pointer ordering and visibility revocation during initialization remain optional coverage extensions, not claims established by the current fixtures.

## Reproduce

```sh
pnpm --filter @mastra-cc/daemon exec vitest run src/__tests__/subscription-initialization.test.ts
pnpm exec turbo run build lint typecheck test --force
node tools/mutations.mjs
pnpm check-docs
```

The broader gaps remain in the [requirements audit](../../AUDIT.md). Semantic Open is a separate rejected experiment on the Mousepad branch. Its restored baseline separately passed a fresh 231-mutation sweep; no native action workaround is shipped here.

# CC-05 — Connection-bound driver authority

Scope: built daemon and transport, real Unix/WebSocket peers, scripted effect sink. No native input cancellation, human takeover, specialist task serialization, or cross-process exclusivity claim.

## Reproduce

From the repository root after building:

```sh
pnpm exec turbo run build
node docs/proofs/reliability-remediation/cc05/demo.mjs
pnpm --filter @mastra-cc/daemon exec vitest run src/__tests__/one-desktop-driver.test.ts
```

The demonstration repeats all four Unix/WebSocket driver/contender combinations across twelve independent backend sessions. Each owner writes before and after the contender attempts an effect; the contender can still query. GREEN requires twelve blocked contenders and zero unauthorized sink calls. It observes the scripted effect sink, not a live application.

The daemon regression adds dispatch-table coverage, retained original capability checks, disconnect with queued effects, and transfer only after the old operation settles. The demonstration accepts an optional built checkout path for comparison against a pre-fix checkout; keep the same demonstration script on both sides.

## Retained results

- `without.txt`: identical demonstration against built checkout 00a9ad1, before the driver patch (also before desktop-only CC-04); 12/12 failures and 12 unauthorized effects, exit 1.
- `with.txt`: current built candidate, 12/12 passing and zero unauthorized effects, exit 0.
- `workspace.txt.gz`: `pnpm exec turbo run build lint typecheck test`, 19/19 successful tasks.
- `mutations.txt.gz`: `node tools/mutations.mjs`, all 244 mutations killed. An earlier sweep exposed a surviving early-release mutation; the added deterministic authority-state regression now kills it. Real-transport disconnect scheduling alone was not sufficient proof of that invariant.

## Boundaries

The owner is the first connection admitted for a non-observe operation, not a user-selected specialist. Disconnect is not cancellation of already-issued input. A refused operation may still retain the ownership claim. One backend instance defines the desktop boundary; deployment must prohibit multiple daemon authorities for the same OS desktop.

Remaining CC-05 work: explicit human revocation/resumption and native cancellation checkpoints, integration with the demo control state, complete-task serialization, and fresh-observation requirements after takeover. See [ADR-0100](../../../02-DECISIONS/0100-one-connection-owns-desktop-effects.md).

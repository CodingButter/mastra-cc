# CC-08 — fresh bounded native-watch ancestry

This is seam-level RED/GREEN verification, **not a live native-application demo**. It drives the entire signal-registration and self-probe path over a scripted bus. No claim of complete subtree coverage or demonstrated native reparenting is made. The missing real-application proof is explicitly retained as follow-up in ADR-0103.

## Rerun

From the repository root:

```sh
pnpm --filter @mastra-cc/daemon exec vitest run src/backends/atspi/__tests__/signal-subscription.test.ts
pnpm exec turbo run build lint typecheck test --force
node tools/mutations.mjs
node tools/freeze-gate.mjs --base 308dccd
pnpm check-docs
```

`without.txt.gz` retains the initial five failing regressions against 308dccd: fresh-read count, both reparenting directions, unreadable-parent recovery, and closure while a parent read is pending. `with.txt.gz` records the expanded suite. The additional cycle, depth and thrown-parent checks are not claimed as part of that initial five-test RED comparison. `workspace.txt.gz` and `mutations.txt.gz` retain final verification gates.

Only proven membership emits. Unknown membership remains silent but is no longer cached as outside. The tests assert both registration/probe success and actual emitted change counts, including continued root delivery after a bounded or failed ancestry check. A pending parent read is settled after close to verify no late delivery.

## Remaining work

A real native reparenting fixture and public-transport capture are still needed for user-surface proof. Versioned degraded-coverage signals, deep-descendant recovery, root-removal lifecycle evidence, queue/retention budgets and atomic tree snapshots are not implemented by this bounded correction. Never infer unchanged state from silence.


## Live reparenting and root removal

[`reparent/README.md`](reparent/README.md) is the native half: a GTK3 fixture moves a text view between frames and windows under a real daemon watch (emits inside, silent outside, resumes when moved back) and destroys the window around it. That run found the daemon calling a watch alive on an element GTK had silently unparented; the stream now asks the bus whether the root still hangs anywhere and ends the watch with `watchEnded` when it does not.

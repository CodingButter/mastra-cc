# Bounded paced Anthropic experiment

This series keeps the existing 24-step / 180-second model deadline and independent saved-file, fresh-UI and visual acceptance requirements. It does not retry desktop effects or restart agent generation. Native acceptance remains unproven until a complete new batch passes those unchanged gates.

## Change and boundary

The isolated driver serializes provider request starts at least three seconds apart, retries only rejected HTTP 429 responses at most twice, respects Retry-After seconds/dates, and declines delays over 30 seconds rather than retrying early. Queue, waiting and fetching share the original cancellation signal. The Mastra retry count is zero. Full instructions and observed content are retained; the predeclared tool set is reduced from 24 to eleven relevant public tools, including capture and document readback, without changing daemon grants. Declaration and trial metadata must agree; executed driver/helper copies are checked against declared repository hashes. Paced review requires actual interception records and minimum request spacing.

An automatic ephemeral cache hint is added at the provider boundary. A small authenticated Messages API probe returned HTTP 200 with nine input tokens, four output tokens, and zero cache creation/read tokens. That proves request-shape acceptance, **not cache hits or savings**. The hint is an experiment, not a claim of reduced token usage.

## Runnable checks

From the repository root:

```sh
node --test docs/proofs/mousepad-verified-find-replace/{evidence,model-supervisor,model-lifecycle,model-rate}.test.mjs
node docs/proofs/mousepad-verified-find-replace/paced-series/mutations.mjs
pnpm turbo run build lint typecheck test --force
node tools/mutations.mjs
pnpm check-docs
```

`targeted-mutations.txt` records seven deliberate rate-control defects rejected by tests and restored GREEN. `tests.txt` records the focused suite. These prove harness behavior, not desktop completion.

For the offline installed-SDK check, copy `sdk-probe.mjs` and `../model-rate.mjs` into an isolated installed consumer, then execute the probe there. It imports the same installed Mastra package as the driver and replaces all network fetches with a fixture. `sdk-probe.txt` records actual adapter interception, authorization/content-type preservation, an identical-body retry after a four-second Retry-After, and successful response decoding. No real credentials, network calls or desktop effects are used by this check. The first fixture assumed streaming; the installed generate path instead required JSON, so the fixture was corrected before obtaining GREEN.

## September 7 live result: REJECTED, no provider quota failure

Batch `/tmp/mousepad-paced.5079nlae` made 24, 24 and 22 requests with no 429 backoff or provider failure. Minimum observed spacing was respectively 3000.017, 3000.078 and 3000.075 ms. Provider usage reported cache reads in all three trials (summed across steps: 1,038,668 / 1,567,550 / 1,485,454 tokens); these repeated-context totals are not unique tokens or a controlled speed/cost comparison. Unlike the earlier tiny probe, the live usage establishes cache hits.

- t1 saved exact expected bytes but exhausted 24 steps without accepted post-save fresh document evidence.
- t2 exhausted 24 steps and failed the exact saved-file oracle.
- t3 saved exact bytes and returned success, but the independent fresh-document trace oracle still rejected it. An agent assertion is not acceptance.

All owned process groups report verified cleanup. No visual review is claimed or manufactured for this rejected batch. `rejected-batch/` retains 74 hash-verified compressed artifacts, including full events, recordings, metadata, original/expected/saved bytes and the content-free summary. Its inventory states exclusions: dependency tree and session home/runtime directories. The original invalid batch remains local. Source/build artifacts were unchanged during execution.

Verification: 106 focused tests; 19/19 uncached workspace tasks; 231 full-suite mutations and seven targeted rate mutations caught; docs/diff checks pass. The offline SDK probe additionally verifies persistent HTTP 500 produces one request with SDK retries disabled, and fetch restoration. Two independent follow-up reviews identified no remaining must-fix. Their timestamp-sampling suggestion was fixed and focused/targeted checks rerun before the live batch.

Next Mousepad work is bounded interaction efficiency and the independent post-save/reopen evidence gap, not an assumption that more provider quota is necessary. Do not increase limits or weaken evidence to reclassify this batch. CC-09 broader measurement work remains in the separate clean reliability worktree; producer-only signal measurements must not be called native-to-notification latency or cancellation proof.

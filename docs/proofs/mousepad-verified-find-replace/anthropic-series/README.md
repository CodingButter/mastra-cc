# Separate Anthropic series — rejected, September 7, 2026

## What changed

Explicit model selection now permits the user-authorized `anthropic/claude-sonnet-4-5-20250929` snapshot while preserving the default Google series. The driver reads the predeclared model and selects its credential variable. Review rejects unapproved models and metadata/declaration mismatches. Temperature 0, 24 steps, the 180-second model deadline, exact saved-file, fresh UI and genuine visual acceptance requirements are unchanged. Trials are not pooled across providers.

`provider-red.txt` records the Anthropic fixture failing before the change; `provider-green.txt` records the updated acceptance-validator tests passing. These are deterministic validator proofs, not live task acceptance. The supplied key authenticated and completed a tiny generation preflight; that did not establish capacity for a full desktop session. It was injected through subprocess environment memory, not saved to a credential file or embedded in source.

## Actual live outcome: REJECTED

Call counts below and in the handoff refer to model-issued public calls; every trial also performed the harness's public setup-readiness query. Original batch: `/tmp/mousepad-anthropic.h7_lzg5v`. All three trials retained their raw `model-failure` category, failed exact saved bytes, and reported verified owned-group cleanup. t1 made eleven public desktop calls, including discovery and field edits, before an Anthropic rate-limit refusal. t2 and t3 made no public calls before the same refusal. Driver response headers report input-token limit 500,000/minute, remaining 0, with retry-after values 10/7/5 seconds. This is rate-limit exhaustion, not an authentication failure, and not proof that the provider remains unavailable indefinitely.

The durable `rejected-rate-limit-batch/` copy contains 72 artifacts with SHA256 inventory: declaration, attempts, logs, public events, task/expected/actual files, recording and installed-import report. Private HOME/runtime and installed dependency trees are excluded. No visual review was created because the machine acceptance already failed. Original evidence paths remain immutable. Source/build mutation did not overlap this batch.

## Verification

- `mutations.txt`: complete final-candidate table, 231 mutations, none survived; run after the live batch ended.
- `workspace-final.txt`: fresh forced workspace build/lint/typecheck/test.
- `evidence-final.txt`: acceptance, supervisor and lifecycle regression suites.
- `docs-final.txt`: documentation links check.
- `reviews/`: independent read-only review reports. Code review is not visual acceptance.

Reproduce deterministic gates with `pnpm turbo run build lint typecheck test --force`, `node --test docs/proofs/mousepad-verified-find-replace/{evidence,model-supervisor,model-lifecycle}.test.mjs`, `node tools/mutations.mjs`, and `pnpm check-docs`. Run mutations without live batches or builds in the same checkout.

## Remaining work

A new complete predeclared batch and genuine visual acceptance are still required. Investigate request pacing/token volume before spending another batch: the retained retry-after evidence suggests a bounded rate-aware experiment may be possible without changing the existing task or acceptance oracles. Any timing change must be declared, tested, and stay within the model/session/batch deadlines; do not silently add retries or pool successful trials. A larger quota is another option, not an established prerequisite. Raw SDK logs bypass the journal redactor, so scan all retained artifacts before publication. The retained-copy credential-pattern scan found no matches; it is not a comprehensive security audit.

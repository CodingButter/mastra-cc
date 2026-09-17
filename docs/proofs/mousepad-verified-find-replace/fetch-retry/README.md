# Pre-response fetch recovery — reviewed bounded batch

September 7, 2026. The complete, separately predeclared 32-step Anthropic batch passed the unchanged exact-file and fresh-post-save public-readback oracles for **all three trials**, followed by genuine model-assisted video/image inspection. `reviewed.txt` records `GREEN`, all three visual checks `COMPLETE`, and human approval still `PENDING`. This does not establish the original 24-step experiment, planned reopen verification, universal desktop reliability, or human approval.

## Transport boundary

`../model-rate.mjs` retries only rejection of `fetch` before a Response is returned. Request construction remains outside the catch. Response/body failures and non-429 HTTP responses are not replayed. Network rejection and 429 share two retries (three total attempts), existing three-second pacing and the original cancellation signal/deadline. No agent generation or desktop action is restarted. A missing response does **not** prove the provider did not process or charge for inference; remote inference duplication remains possible.

Six targeted tests cover identical request bodies/headers, the shared finite budget, cancellation in retry sleep and during pending fetch, non-replayed response-body failure, and non-target/non-rate failures. The installed SDK probe recovers an injected socket failure and proves persistent failure stops after three attempts with framework retries disabled. Three isolated scratch mutations are caught. Final focused suites: 114 passing. Forced workspace gates: 19/19. Full mutation sweep: 231 caught.

## Runnable proof

```sh
bash docs/proofs/mousepad-verified-find-replace/fetch-retry/demo.sh /tmp/mousepad-fetch-retry.pvwupc_f/installed/consumer
node --test docs/proofs/mousepad-verified-find-replace/fetch-retry/fetch-retry.test.mjs
node docs/proofs/mousepad-verified-find-replace/fetch-retry/mutations.mjs
node docs/proofs/mousepad-verified-find-replace/model-batch.mjs --review /tmp/mousepad-fetch-retry.pvwupc_f
```

The first command runs the same offline injected-failure probe against the actual installed SDK with baseline `2e48a59` and current helper: `without.txt` is RED, `with.txt` is GREEN. It requires the retained local installed consumer (not committed dependencies). Live acceptance is separate and uses real provider calls; `batch.txt` preserves its initial REVIEW_PENDING exit before actual media review. Tests and SDK interception are not substituted for that live run.

## Live outcome and inspection provenance

- t1: 28 provider attempts, one real pre-response retry; exact bytes and post-save readback passed at call 26.
- t2: 25 provider attempts, one real pre-response retry; exact bytes and post-save readback passed at call 23.
- t3: 20 provider attempts, no pre-response retry; exact bytes and post-save readback passed at call 22.
- All three owned process groups report verified cleanup. One batch, unchanged declared runtime/harness artifacts; no pooling of earlier successes.

Gemini 2.5 Flash received each actual complete recording (MP4 remux) and four actual PNG checkpoints. Decoded-video SHA256 equivalence proves the inspected MP4 carries the original MKV's identical video frames. Wren reconciled the returned reports with the public journal and unchanged exact-byte/readback oracles; Wren's direct image-view tool returned raw bytes, so **no direct Wren visual inspection or human review is claimed**.

Original reports, prompts, hashes and conflicting interpretations are retained. t3 initially misread zero as eight; a blind magnified-image pass correctly read the replacement token. Subsequent punctuation classification was inconsistent. It is explicitly rejected as a Unicode claim: pixels establish the visible long separator, while exact U+2014 bytes are established only by the disk/public-readback oracles. Similarly, a visible Save menu interaction was not observed; journaled Save activation, fresh readback and disk bytes establish durability, not video. Both independent reviewers accepted this explicit separation without changing the visual validator. Final review records preserve those resolutions, not fabricated observations.

`reviewed-batch/inventory.json` indexes 128 independently hash-verified compressed artifacts, including recordings, checkpoints, original/expected/saved documents, journals, metadata, declaration, executed helper copies, raw inspection responses and review records. Credential-pattern scanning passed. Dependency trees and private HOME/runtime directories are excluded; the original batch remains local. `retain-batch.py` is the retention/verification command; `visual-inspect.py` records actual video/image inputs and provider output, not automatic approval. Human approval and planned explicit reopen verification remain follow-ups.

## CC-09 boundary

Native end-to-end persistence latency and cancellation acknowledgement remain unmeasured. Installed CLI declarations now establish the configuration seam `notifications.deliveryPolicy.decide: () => 'persist'` and direct `NotificationsStorage.listNotifications({threadId})` polling; configuration nesting is no longer merely an expert inference. Adapter initialization, real native injection/correlation and cancellation ownership still need a separate experiment. Client closure remains insufficient evidence of native cancellation.

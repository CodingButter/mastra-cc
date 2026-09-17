# ADR-0098: Typing attempts are not insertion proofs

Status: accepted for reliability remediation, September 7, 2026.

## Evidence

CC-02's scripted-channel counterexamples reproduce in the real native backend: correctly published emoji was compared as one code point against two UTF-16 units and rejected; selected replacement was rejected for not increasing length. Equal-length wrong text and autocomplete show why correcting the count alone cannot establish delivery.

## Decision

In schema version 1.21.2, remove length-based insertion verdicts entirely. The backend has no trustworthy near-emission caret/selection witness, so it does not invent an exact postcondition. It emits once and preserves the observed element, with `mastra-cc/typing-unverified` in the existing diagnostic extension. Server focus-note wrapping preserves this evidence. No new wire shape, automatic semantic-setter fallback, clear, replay or observation loop is added. A successful request means emission was attempted, not that insertion was verified. Callers must observe before deciding on recovery.

Keep the existing 1024 UTF-16-code-unit resource bound deliberately: expanding it to 1024 scalars would increase accepted payloads. Name the unit accurately. Reject unpaired surrogates before effect; preserve valid text exactly, including combining sequences, with no normalization. Content lengths used for explicit clearing remain code-point based; neither those lengths nor grapheme counts are compared against typing payload units anymore.

## Verification and limits

Scripted native backend tests cover ASCII, emoji, supplementary characters, combining sequences, mixed scripts, selected replacement, middle insertion, truncation, wrong same-length text, unchanged/delayed publication, autocomplete and unavailable content. They require an unverified diagnostic and exactly one emission. Server tests cover unpaired surrogates, accepted/rejected UTF-16 boundaries, evidence preservation and authority separation. Existing focus tests remain required.

This patch does not add exact insertion verification, live IME/selection tests, or bounded polling. A single readback is allowed to remain indeterminate. Post-emission exceptions and human-intervened focus restoration need separate investigation; no claim is made that those paths have been repaired here. Mousepad live/visual acceptance remains independent. See the [proof](../proofs/reliability-remediation/cc02/README.md).

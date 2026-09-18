# CC-02: an uncertain keystroke is never sent twice (adapter level)

The remediation plan asked for an integration check that "an uncertain first
attempt cannot become duplicate insertion through adapter retries". The
backend's side was done in `cc02/`: a typed text is answered as attempted and
unverified (ADR-0098), one emission only. This is the layer above it.

## What is pinned

`packages/desktop/src/__tests__/an-uncertain-keystroke-is-never-sent-twice.test.ts`
drives the real `AtspiBackend` over the recorded GTK dialog tape, through a
real daemon on a Unix socket, the real transport and the real Mastra tool,
and counts `GenerateKeyboardEvent` at the D-Bus seam.

| Case | What the caller gets | Emissions |
|---|---|---|
| UNVERIFIED - focus never confirmed, re-read fine | a result with `mastra-cc/typing-unverified` in its diagnostic; no refusal, no throw | 1 |
| LOST - the emission went out, the re-read's first bus call fails once | an error (`the desktop could not be read by this session's backend`) | 1 |

The LOST fixture dies for exactly one call and then recovers, so a retrying
wrapper would find a working line. A first draft killed the whole connection
instead; a `catch { retry }` mutation survived it, because the retry was
stopped by the dead dial rather than by there being no retry. That draft was
replaced, not kept.

## Mutations

Two entries in `tools/mutations.json`, both replacing the tool's one call to the client:

- `the-adapter-types-again-when-it-reads-unverified` - call again when the
  answer carries `typing-unverified`. Caught (2 emissions).
- `the-adapter-types-again-when-the-answer-is-lost` - `catch { call again }`.
  Caught (2 emissions).

## Demonstration (`demo.mjs`)

Built artifacts only. `with.txt` is this branch (`workspace.txt.gz` the forced 19/19 gates, `mutations.txt.gz` the 280/280 sweep): one `[0, "example.com", 4]`
STRING emission per trial, `PROOF: GREEN`. `without.txt` is the same demo
with both mutations applied to the adapter source and rebuilt: both trials
emit `example.com` twice, and the LOST trial *resolves* - the caller is told
the text arrived once when it arrived twice. `PROOF: RED`.

    node docs/proofs/reliability-remediation/cc02/adapter-retry/demo.mjs .

## What this does not claim

- Nothing about a model choosing to call `typeText` twice: that is the
  model's decision, and the tool returns the doubt for it to read.
- A lost reply on a *live* line (daemon never answers) is not covered: the
  transport has no per-request timeout, so such a call waits rather than
  retries. That is not duplication, but it is not a bounded wait either;
  recorded in FOLLOWUPS.
- Focus restoration after a post-emission exception (still open, CC-02).

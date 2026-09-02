# 0069 — A name is the same name in any case

**Status:** accepted
**Date:** 2026-09-02
**No schema change.** The wire contract stays at 1.12.0; nothing on the wire gains or
loses a field. What changes is what *equal* means when two application names meet.

## Context

Application names cross the daemon at six places: the operator's grants and permits, the
installed inventory's entry ids, the launch catalog's recipe keys, the ownership table's
records, the running census, and the accessibility tree's own `application` nodes. Every
one of those comparisons went through one helper, `normalise()`, which is NFKC and
nothing else. NFKC is the right rule for **element** names: a math-bold `OK` is the `OK`
button, but `ok` is a different label and must not match it.

Applied to **application** names it was one letter too strict. Measured on the demo desk
on 2026-09-02: Chromium registers on the accessibility bus as `Chromium`. Its desktop
entry id, and so the operator's `--grant chromium` and `--permit chromium`, read
`chromium`. Under NFKC alone the daemon walked past the application (grant miss), the
census reported the entry `not-answering` (name miss), and an agent that had just launched
the browser was told it had no window — all while a terms-of-service dialog with an
`Accept` button sat published on the bus. Restarting the daemon with `--grant Chromium`
(one capital letter) made the application, the dialog and the button appear. There was
no missing capability; there was one comparison with the wrong idea of equality.

## Decision

1. **Application names are compared NFKC-normalised *and* case-folded.** A second helper,
   `applicationName()` (`daemon/src/backends/atspi/names.ts`), is `normalise()` followed by
   `toLowerCase()`, and every comparison of an application name uses it: grants and their
   composition, permits and their resolution (ADR-0068), inventory index keys and
   candidate derivation, catalog recipe lookup, ownership records and `ownsName`, the
   census names each backend reports, the `application`-node filter in the tree walk, and
   configuration keyed per application (capability withholding, restart levels). The fold
   is exactly `toLowerCase()` after NFKC — no locale-specific rule.

2. **Element names do not move.** `nameMatches()` and every `queryElements({ name })`
   filter stay NFKC-only. `OK` does not match `ok`. The distinction is by *what the
   string is*, not where it is compared: a string measured against a grant, permit,
   entry id, catalog key, ownership record, census name or `appearsAs` is an application
   name; a string measured against a label on the screen is an element name.

3. **The inventory scan keeps the ids the disk holds.** `scanInstalledApplications`
   normalises ids by NFKC only. Two desktop files whose ids differ only by case are two
   entries in the scan; it is the resolver's index (`indexInventory`) that folds them and
   finds they contend for one name. So case-folding slots *under* ADR-0068: it is what
   equality means, and a `Kate`/`kate` entry pair becomes an ordinary contested candidate
   that refuses as ambiguous, rather than one silently hiding the other.

4. **Visibility stays grant-gated.** A hand-launched application the operator did not
   grant is exactly as invisible as before. Only the comparison changed, never who gets
   compared.

## Consequences

- `--grant chromium` makes the bus's `Chromium` observable; `listApplications` reports the
  `chromium` entry `answering` while it is on the bus; an agent can read and press the
  `Accept` button on its first-run dialog.
- Configured per-application keys (`restart.applications`, capability blocks) and
  ownership records are now stored folded, so a setting written as `Kate` reports itself
  as `restart.applications["kate"]`. That spelling change is visible in refusal text and
  is deliberate: the setting names the application, not the operator's keystrokes.
- A desk with two entries whose ids differ only by case now refuses both by short name and
  by either full id, where before one of them was reachable and the other was not. This
  is ADR-0068's ambiguity cost applied to a new equality, and is stated rather than hidden.

## Evidence

- `daemon/src/__tests__/one-name-any-case.test.ts` — T1 grant, T2 census, T3 permit,
  T4 ownership, T5 catalog, T6 case-only pair refuses, T7 element names unchanged.
- `tools/mutations.json` `an-application-name-is-only-the-same-name-in-one-case` deletes
  the fold; six tests go red.
- Live proof, base versus branch on the same desk with the same grants:
  `.mastracode/plans/one-name-any-case.proof/` (Phase 2 of the plan).

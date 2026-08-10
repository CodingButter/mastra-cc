# 0036 — Grants live in a file the daemon owns

Status: accepted, 2026-08-10 (M2.3)

## Context

Deny-by-default application visibility is doctrine: an application the
operator has not granted "is *invisible* ... a visible-but-blocked app tells
the agent something about the user's machine that the user did not agree to
share" (`docs/00-PRODUCT.md:101`, ADR-0008). Until M2.3 nothing enforced it —
both backends read every application on their route
(`daemon/src/backends/atspi/index.ts` walked every bus child;
`daemon/src/backends/cdp/index.ts` synthesized the browser application
unconditionally). Something has to say WHICH applications are granted, and
the consent surface that will eventually ask the operator does not arrive
until M4. Two shapes were considered: session-only flags (grants die with the
process, like `--permit`), or a daemon-local permissions file plus session
flags. The user chose the file (2026-08-10, "go with your pics" accepting the
recommendation on record): a file is inspectable with `cat`, survives
restarts, and is the natural thing M4's consent UI will later write.

## Decision

Observe grants live in a **daemon-local permissions file** the operator owns,
read once at daemon boot, union-composed with session flags
(`daemon/src/grants.ts`):

1. **The file** is JSON, `{"applications": ["name", ...]}`, named by
   `--grants <path>`. Entries are NFKC-normalised at load — the set itself is
   normalised, so a math-bold entry matches its plain form (the M0.5 lesson,
   `daemon/src/backends/atspi/names.ts`) and membership checks never see raw
   file bytes.
2. **Absence grants nothing.** No file, no flag, no permit — the daemon
   answers an empty world. Deny-by-default is the backend's own posture: a
   backend constructed without a visibility set uses the empty set
   (`daemon/src/backends/registry.ts`), not "all".
3. **A malformed file fails startup loudly** with a named error
   (`MalformedGrantsFileError`). A permissions file that cannot be parsed
   must not silently become "no grants" — the operator meant something, and
   guessing "nothing" in its place is a silent policy change.
4. **The effective observe set is a union**: grants file ∪ `--grant` flags
   (the session-scoped observe analog of `--permit`, for reading
   applications the daemon did not launch) ∪ `--permit` names. A launch
   permit implies an observe grant because the launch poll already reads the
   launched application (`daemon/src/server.ts` findApplication) — a permit
   without visibility would make a permitted launch unreadable forever. The
   union is composed ONCE at boot in `daemon/src/main.ts` and nowhere else.
5. **`"all"` is a mode, never a default.** Trust is a mode (ADR-0028); tests
   and YOLO operators state `visibility: "all"` explicitly. Nothing in the
   daemon falls back to it.
6. **Enforcement lives inside the walk, not in a post-filter.** A
   server-level filter of query results would still READ the ungranted tree;
   the doctrine is about not touching what was not granted. The atspi walk
   reads each application's name and skips the entire subtree before any
   element is read (`daemon/src/backends/atspi/index.ts` queryElements); the
   cdp route issues the one `version` exchange the name derives from and,
   when the name is not granted, answers empty having issued only that
   exchange — never `list`, never a target dial, never `Accessibility.*`
   (`daemon/src/backends/cdp/index.ts` queryElements).

## Consequences

- An ungranted running application is absent from every answer, and its
  absence is byte-identical to the absence of an application that does not
  exist (`daemon/src/backends/__tests__/invisibility.test.ts` compares the
  full wire-shaped responses).
- **The honest cost, stated plainly: the daemon reads an ungranted
  application's NAME to decide visibility.** On atspi that is the accessible
  name of each bus child; on cdp it is the single `version` exchange the
  product token derives from. You cannot decide visibility without the name.
  The invisibility guarantee is *subtree-never-read*, not *name-never-read*.
- Grants are by NFKC name: two applications sharing a name share a grant.
  This is a stated limitation at name-only granularity; M2.4's pid join is
  the disambiguator (`daemon/src/server.ts` idempotent re-open comment).
- The file is read at boot only. Live reload and mid-session revocation are
  out of scope until a later milestone; changing the file requires a daemon
  restart.
- Durable grants beyond observe (edit/activate/submit authority) are
  deliberately NOT in the file — that ladder arrives with M4's consent
  surface (ADR-0021 governs submit arming).
- Every deny-by-default enforcement site carries a mutation
  (`tools/mutations.json`: `absent-grants-file-grants-everything`,
  `visibility-filter-never-consulted`, `cdp-visibility-never-consulted`) per
  the mandatory list in `docs/05-TEST-STRATEGY.md:72`.

## Evidence

- Invisibility doctrine: `docs/00-PRODUCT.md:101`; four per-app states never
  collapsed: ADR-0008.
- Both backends read everything before this change:
  `daemon/src/backends/atspi/index.ts` (walk over every root child),
  `daemon/src/backends/cdp/index.ts` (unconditional application synthesis) at
  merge base 6ced1cc.
- NFKC as the shared name law: `daemon/src/backends/atspi/names.ts` (the
  math-bold lesson: a plain substring search matched 0 of 30 candidates;
  after NFKC exactly 1).
- Launch-implies-observe: the poll loop reads the launched application
  through `backend.queryElements` (`daemon/src/server.ts` findApplication) —
  codifying what M2.2's `--permit`-only demo flows already did.
- The one-exchange cdp gate witnessed by a recording channel wrapper:
  `daemon/src/backends/__tests__/invisibility.test.ts` asserts the issued
  exchanges are exactly `[{kind:"version"}]`.

# 0038 — A browser profile is a launch identity

Status: accepted, 2026-08-11 (M2.3b)

## Context

The browser profile is already a boundary this project does not enforce and
does not need to: "the browser profile is a real boundary, enforced by someone
other than us ... the permission grain drops from per-application to
per-account" (ADR-0028), and "the browser profile is the fence, enforced by
that profile. The daemon's verbs are the gate" (ADR-0032:29-31). Chrome makes
the fence unavoidable: since Chrome 136 the debugging port is ignored unless
`--user-data-dir` is non-default
(`docs/proofs/what-the-browser-protocol-gives-us.md:6-8`), so the operator's
daily-driver profile is unreachable by construction.

Until M2.3b the daemon had exactly one browser identity: `recipes.ts` hardcoded
`--user-data-dir=/tmp/mastra-cc/chrome-profile` (M2.2, commit `beba9c2`). Two
consequences forced this decision. First, `/tmp` does not survive a reboot, so
a signed-in identity cannot live there — and M2.5's live-Gmail item needs
exactly that: an operator who "signs in by hand once" into "a dedicated profile
directory" (`docs/09-QUESTIONS.md:145-155`). Second, one identity means the
authority question the goal queue parked has no answer: permitting `chrome` is
not the same as permitting `chrome-with-work-profile`
(`.mastracode/plans/goal-queue.md:53-58`).

The rejected alternative was the one the queue item guessed at: a schema-visible
option on `openApplication` (`{name, profile}`), which would have bumped schema
1.2.0 → 1.3.0 through the freeze gate. It loses on four counts. (1) It puts
wire bytes adjacent to argv, next to a filesystem path — the exact adjacency
`daemon/src/launch/recipes.ts:10-12` forbids ("wire input selects a catalog key
and never contributes argv content"). (2) It forces the permit model into a
second dimension: `permits` is a flat NFKC name set (`daemon/src/server.ts:127`,
`daemon/src/grants.ts`), and a profile parameter makes authority a pair. (3) It
moves the frozen wire for something the wire does not need to know. (4) It does
not avoid any work: the appears-as join below is required under *both* shapes,
because the browser reports its own name regardless of which profile it opened.
Names ride every existing rail for free.

## Decision

A named browser profile is a **catalog key**, composed at boot from an
operator-owned file (`daemon/src/launch/profiles.ts`):

1. **The profiles file** is JSON,
   `{"browserProfiles": [{"name": "chrome-work", "directory": "/abs/path"}, ...]}`,
   named by `--profiles <path>`, read once at boot. It follows the grants
   file's rules exactly (ADR-0036): absence composes nothing, names are
   NFKC-normalised at load before any comparison, and a malformed file fails
   startup loudly with a named error (`MalformedProfilesFileError`) rather than
   silently becoming "no profiles".
2. **Each profile becomes a recipe** cloned from the built-in `chrome` recipe
   with its `--user-data-dir` argument swapped for that profile's directory.
   Composition is pure and boot-time; the base catalog is never mutated and the
   built-in entry's argv stays byte-identical (asserted in
   `daemon/src/launch/__tests__/profiles.test.ts`).
3. **The daemon never looks inside a profile directory** — it does not read,
   list, create, or even `stat` it. **Including the decision not to stat it**:
   a directory that does not exist or is not writable is not checked at load.
   Chrome creates it or exits, and the operator sees the honest "opened but did
   not become readable" refusal (`daemon/src/server.ts` poll timeout). A nicer
   error is not worth the daemon inspecting a signed-in identity's home.
4. **Refusals at load, each with its own message**: a relative directory (the
   daemon will not resolve one against its own cwd), a name that shadows a
   built-in recipe, two profiles sharing a name, and **two profiles sharing a
   directory** — including the built-in's own `/tmp/mastra-cc/chrome-profile`.
   Two identities sharing one directory share one cookie jar, which defeats the
   boundary the milestone claims.
5. **`appearsAs` is the join.** A recipe may declare the name its application
   answers to in the semantic tree. The composed profile recipes declare
   `chrome`, because the cdp backend derives the application's name from the
   browser's own version reply (`daemon/src/backends/cdp/index.ts:51-57`) and
   the browser says "Chrome" whichever profile it opened. The launch poll and
   the pre-spawn check match on the tree name; **observe** names — `--permit`
   names, grants-file entries and `--grant` flags — are expanded through
   `appearsAs`, or a permitted launch would be unreadable forever.
6. **Launch authority is never expanded through `appearsAs`.** Expanding it
   would turn `--permit chrome-work` into permission to launch the built-in
   `chrome` on its own profile — a different identity, and a silent authority
   leak. The boot composer returns the authority set unexpanded and the observe
   set expanded (`daemon/src/launch/profiles.ts`), and the split carries its own
   mutation.
7. **One browser identity at a time**, refused by name. The backend dials a
   single debugging endpoint (`daemon/src/backends/cdp/channel.ts:14`), so two
   profiles would fight over one port. Opening a second identity while one this
   daemon launched is running is refused with its own constant; nothing is ever
   killed to make room (ADR-0027).

## Consequences

- **The tree still says "chrome".** A profile identity is a launch-time and
  authority-time concept; the semantic tree reports the application's own name.
  Two identities cannot be told apart by reading elements — per-element
  provenance is M2.4's attribution work (`daemon/src/launch/table.ts:14-19`).
- **Permitting one identity implies observing whatever answers on the
  endpoint.** Because observe names expand to the tree name, `--permit
  chrome-work` grants visibility of `chrome` — which, while the daemon's own
  browser is the thing on the endpoint, is the same browser. This is the honest
  cost of a derived name, and it is why the conflict guard exists.
- **Duplicate-directory detection is a string comparison.** Symlinks and
  alternative spellings (`/a/./b`) evade it. Catching them would require
  stat-ing the directory, which decision 3 forbids; this is an accepted gap,
  recorded here rather than quietly tolerated.
- **One identity at a time is this daemon's constant, not the browser's rule.**
  `DEBUG_PORT` is a hardcoded number and the backend holds one channel; Chrome
  will take any port, and the channel suite already launches it with
  `--remote-debugging-port=0`
  (`daemon/src/backends/cdp/__tests__/channel.test.ts:165-169`). Running several
  identities at once is a port per launched identity and a channel per identity
  — scoped work this milestone declines, because the milestone is about identity
  and not concurrency. The refusal is by name, so lifting it later adds a
  capability rather than reversing this decision.
- **The file is read at boot only** — same as grants (ADR-0036). Adding a
  profile requires a daemon restart.
- **An operator who deliberately points a profile at
  `/tmp/mastra-cc/chrome-profile` is refused at boot.** That is intended: the
  built-in identity owns that jar.
- The profiles file is what M2.5's live-Gmail proof needs — a durable directory
  an operator signs into once by hand (`docs/09-QUESTIONS.md:145-155`) — but
  M2.3b itself proves separation without any account.
- Schema is untouched: `protocol/schema.json` stays at version 1.2.0 and
  `git diff master -- protocol/schema.json` is empty for the whole milestone.

## Evidence

- The profile as an externally enforced fence: ADR-0028 (per-account grain),
  ADR-0032:29-31 ("the profile is the fence, the daemon's verbs are the gate").
- Chrome ≥136 ignores `--remote-debugging-port` without a non-default
  `--user-data-dir`: measured in M0.5,
  `docs/proofs/what-the-browser-protocol-gives-us.md:6-8`.
- The hardcoded `/tmp` profile this milestone makes selectable:
  `daemon/src/launch/recipes.ts` at M2.2 (commit `beba9c2`).
- argv is static data selected by a catalog key: `daemon/src/launch/recipes.ts:10-12`.
- The derived browser name the join exists for:
  `daemon/src/backends/cdp/index.ts:51-57` (product token before "/", lowercased).
- One debugging endpoint: `daemon/src/backends/cdp/channel.ts:14`.
- Name lookups resolve the way the spawner does (NFKC): `findRecipe` in
  `daemon/src/launch/spawn.ts`, exported for the join — a naive `catalog[name]`
  misses the math-bold form (the M0.5 lesson,
  `daemon/src/backends/atspi/names.ts`).
- The grants-file pattern this file copies: ADR-0036,
  `daemon/src/grants.ts`.
- Enforcement carries mutations per `docs/05-TEST-STRATEGY.md:72`:
  `malformed-profiles-file-composes-nothing` (`tools/mutations.json`).

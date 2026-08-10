# Source-level pins

`docs/01-ARCHITECTURE.md:139-150` divides the twelve boundaries by enforcement:
**nine are source-level tests** — B1–B5 and B8–B11 — which is the nine that
`docs/05-TEST-STRATEGY.md:130` means by "all nine pins". **B6, B7 and B12 are CI
jobs**, not source pins: the schema freeze gate and the regenerate-and-diff land
in Phase 2 with the schema they guard, and the licence check is
`tools/licences.mjs`, run over every manifest as its own CI job.

`run.mjs` (CI step 4) executes the wired set and fails if it disagrees with the
declared list below, so a silently dropped pin is a red build.

Wired: b1, b10, b11, b5, b8

- **B1** — only `daemon/**` imports a D-Bus or accessibility binding.
- **B5** — no second socket implementation outside `packages/transport` (the one
  daemon client, ADR-0003). The daemon serves the socket, so it is not scanned.
- **B8** — no `xdotool`, `wmctrl`, or `uinput` anywhere (ADR-0004:32).
- **B10** — no platform vocabulary on the wire (ADR-0018): a deny-list matched
  against every field name, enum value, method name, description, role and
  state in `protocol/schema.json`. The one exemption is any subtree under a
  field named `diagnostic` (clause 6), encoded by field name, not by pattern.
- **B11** — effects enforced before the call, not after: the only *timing* pin
  (`docs/05-TEST-STRATEGY.md:33`), wired in the same commit as
  `openApplication`, the first effect-class operation (M2.1, ADR-0034). Reads
  the daemon's dispatch table and asserts every non-`observe` entry is marked
  `enforcement: "before-call"` — result-time enforcement is legitimate only
  for observe. The pin pins the declaration; the enforcement timing is pinned
  by the ordering test in `daemon/src/__tests__/launch-authority.test.ts`.

Deliberately not wired — four, each because its subject does not exist:

- **B2** (audio stays in clients) — there is no audio package.
- **B3** (client credentials never touch the daemon) — there is no client.
- **B4** (microphone consumers) — there is no client.
- **B9** (transcriber isolation) — there is no client.

Five wired plus four absent is the nine. Check the arithmetic
against the files in this directory rather than trusting this paragraph:
`run.mjs` does exactly that on every CI run.

Every pin: strips comments before matching, excludes `tools/pins/` so it cannot
flag itself, resolves paths from the repository root, and exits non-zero when its
file set is empty with the message `no files matched - the pin would pass
vacuously`. Those guards are themselves tested: `tools/mutations.mjs` (CI step 8)
removes each pin's non-empty-set assertion and requires at least one test to go
red.

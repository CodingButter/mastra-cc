# Source-level pins

`docs/01-ARCHITECTURE.md` divides the boundaries by enforcement: **five are
source-level tests** — B1, B5, B8, B10 and B11 — and **B6, B7 and B12 are CI
jobs**, not source pins: the schema freeze gate and the regenerate-and-diff are
`tools/freeze-gate.mjs` and `tools/determinism.mjs`, and the licence check is
`tools/licences.mjs`, run over every manifest as its own CI job.

`run.mjs` (CI step 4) executes the wired set and fails if it disagrees with the
declared list below, so a silently dropped pin is a red build.

Wired: b1, b10, b11, b5, b8

- **B1** — only `daemon/**` imports a D-Bus or accessibility binding.
- **B5** — no second socket implementation outside `packages/transport` (the one
  daemon client, ADR-0003). The daemon serves the socket, so it is not scanned.
- **B8** — `xdotool`, `wmctrl` and `uinput` appear only inside the raw-input
  operation class, and nowhere else (ADR-0046:46, which struck ADR-0004's
  outright ban at `0004:34` and replaced it with containment). The contained
  set is empty today because no such class exists yet, so the pin behaves as
  the ban did and says so in its own report; the milestone that builds the
  class adds its path in a diff.
- **B10** — no platform vocabulary on the wire (ADR-0018): a deny-list matched
  against every field name, enum value, method name, description, role and
  state in `protocol/schema.json`. The one exemption is any subtree under a
  field named `diagnostic` (clause 6), encoded by field name, not by pattern.
- **B11** — effects enforced before the call, not after: the only *timing* pin,
  wired in the same commit as `openApplication`, the first effect-class
  operation (M2.1, ADR-0034). Reads the daemon's dispatch table and asserts
  every non-`observe` entry is marked `enforcement: "before-call"` —
  result-time enforcement is legitimate only for observe. The pin pins the
  declaration; the enforcement timing is pinned by the ordering test in
  `daemon/src/__tests__/launch-authority.test.ts`.

## The four pins that left with the clients (ADR-0057)

**B2, B3, B4 and B9 were client pins and are gone.** Each one's subject was a
process this repository no longer builds: B2 asserted the hub held no audio, B3
that a client held no provider credential, B4 that a client had at most one
microphone consumer, B9 that no client carried a transcriber. Their file sets
were `apps/**`, and `apps/` was removed by ADR-0057.

They were deleted rather than retargeted because every one of them guards the
same thing — the boundary between an assistant's audio/model machinery and the
desktop peripheral — and that boundary is now the repository edge itself.
A pin whose subject does not exist is not a passing pin; it is a pin that
would exit non-zero on its own vacuous-set guard, and silencing that guard to
keep the count at nine would be the exact dishonesty the pins exist to prevent.
When the assistant is rebuilt as a consumer of this package, these four belong
in **its** repository, where its `apps/**` lives.

Check the arithmetic against the files in this directory rather than trusting
this paragraph: `run.mjs` does exactly that on every CI run.

Every pin: strips comments before matching, excludes `tools/pins/` so it cannot
flag itself, resolves paths from the repository root, and exits non-zero when its
file set is empty with the message `no files matched - the pin would pass
vacuously`. Those guards are themselves tested: `tools/mutations.mjs` (CI step 8)
removes each pin's non-empty-set assertion and requires at least one test to go
red.

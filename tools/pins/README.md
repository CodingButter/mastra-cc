# Source-level pins

`docs/01-ARCHITECTURE.md:139-150` divides the twelve boundaries by enforcement:
**nine are source-level tests** — B1–B5 and B8–B11 — which is the nine that
`docs/05-TEST-STRATEGY.md:130` means by "all nine pins". **B6, B7 and B12 are CI
jobs**, not source pins: the schema freeze gate and the regenerate-and-diff land
in Phase 2 with the schema they guard, and the licence check is
`tools/licences.mjs`, run over every manifest as its own CI job.

`run.mjs` (CI step 4) executes the wired set and fails if it disagrees with the
declared list below, so a silently dropped pin is a red build.

Wired: b1, b10, b11, b2, b3, b4, b5, b8, b9

- **B1** — only `daemon/**` imports a D-Bus or accessibility binding.
- **B2** — audio stays in the clients: the hub holds none (ADR-0006). Two halves,
  because the prototype's transcriber removal was only half a removal — the
  source went, the dependency stayed declared. The **source half** scans
  `apps/hub/**` for audio APIs, audio buffer types and the provider's audio
  URLs; the **manifest half** reads `apps/hub/package.json` and fails on a
  declared audio dependency, imported or not. A missing manifest fails as a
  vacuous pass, because a hub whose declarations were never read is not a hub
  that declares nothing.
- **B3** — clients receive minted tokens and hold no provider credential or
  provider SDK (ADR-0007). The source half scans every client under `apps/**`
  except the hub, and the manifest half catches credential machinery that was
  declared but never imported. Its runtime half remains the voice-lane test
  that refuses a caller-supplied credential.
- **B4** — at most one microphone consumer per client process. M4's honest
  count is zero because wake-word capture does not arrive until M5. The pin
  prints the count: zero is green but visible, exactly one is also green, and
  two or more is red. Its output therefore changes when the first real subject
  appears instead of letting a permanent zero look like proof.
- **B5** — no second socket implementation outside `packages/transport` (the one
  daemon client, ADR-0003). The daemon serves the socket, so it is not scanned.
- **B8** — `xdotool`, `wmctrl` and `uinput` appear only inside the raw-input
  operation class, and nowhere else (ADR-0046:46, which struck ADR-0004's
  outright ban at `0004:34` and replaced it with containment). The contained
  set is empty today because no such class exists yet, so the pin behaves as
  the ban did and says so in its own report; the milestone that builds the
  class adds its path in a diff.
- **B9** — no transcriber in any client (ADR-0005). It scans source and every
  client manifest because the prototype deleted the code and left
  `@huggingface/transformers` installed; comments are stripped so the record
  explaining that deletion does not indict itself.
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

All nine source-level pins are wired. Check the arithmetic against the files in
this directory rather than trusting this paragraph: `run.mjs` does exactly that
on every CI run.

Every pin: strips comments before matching, excludes `tools/pins/` so it cannot
flag itself, resolves paths from the repository root, and exits non-zero when its
file set is empty with the message `no files matched - the pin would pass
vacuously`. Those guards are themselves tested: `tools/mutations.mjs` (CI step 8)
removes each pin's non-empty-set assertion and requires at least one test to go
red.

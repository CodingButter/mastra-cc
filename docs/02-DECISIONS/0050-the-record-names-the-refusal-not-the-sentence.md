# 0050 — The record names the refusal, not the sentence

- Status: accepted
- Date: 2026-08-20
- Relates to: [0026](0026-the-audit-log-is-an-access-record-episodes-are-the-narrative.md) (amends), [0042](0042-existence-is-readable-content-is-not.md), [0022](0022-failure-to-act-is-harm-we-caused.md), [0019](0019-capability-is-not-authority.md), [0039](0039-the-desktop-talks-first.md), M3 segment 1
- Amended by: [0073](0073-an-observation-that-ran-out-of-budget-names-itself.md)

## Context

ADR-0026 put the access record at the point of effect and fixed its seven fields:
`at`, `application`, `element`, `scope`, `cause`, `attestation`, `outcome`. It
settled what the record is *for* and left one question open that only turns out
to matter once the file is being written: what an `outcome` of "refused" actually
contains.

The obvious answer — store the refusal the caller was handed — is a content leak,
and it is not theoretical. This daemon's refusal sentences quote the tree back at
you, verified at source while planning M3:

| Site | What the sentence embeds |
|---|---|
| `daemon/src/backend.ts:185` | `JSON.stringify(element.name)` — the element's accessible name |
| `daemon/src/backends/atspi/effects.ts:212` | *"found `<observed>` where `<intended>` was intended"* — the observed value is literally what the element now says |
| `daemon/src/backends/atspi/index.ts:507` | the action word and the element's name |
| `daemon/src/server.ts` `focusNotRestored` | element names on both sides of the comparison |

An accessible name is frequently the user's own text: a subject line, a filename,
a recipient. `effects-are-observed.test.ts` already asserts a content value inside
one of these messages, so the leak is measured rather than imagined. Storing those
sentences would put user text into the access record through the back door while
the entry's key set — the thing a test can easily assert — stayed perfectly
correct. It would also contradict ADR-0042, which says content is not readable.

A second problem sits beside the first. An earlier draft of this decision said the
entry should record "the named error type: `AttestationFailed`, `WriteNotObserved`,
`LaunchNotPermitted`, and so on". Review found `LaunchNotPermitted` **does not
exist anywhere in this codebase** — the launch refusals are string constants, not
error classes, as are the scope refusals and the subscription refusals. A vocabulary
with an "and so on" invites a hand-authored string at the recording site, and a
hand-authored string is a sentence with fewer words.

## Decision

1. **`outcome` records a refusal's CLASS, never its sentence.** `performed`, `read`,
   `failed`, or `refused:<Class>`. The sentence goes to the caller, as it always has.
   It does not go to disk.

2. **The class vocabulary is a closed, enumerated set, asserted by a test**
   (`daemon/src/audit.ts`, `REFUSAL_CLASSES`). A refusal naming anything outside the
   set is a build error, not a new string. The set holds thirty names: the nine seam
   error classes `performEffect` translates, recorded under their constructor name so
   the record and the throw site cannot drift, plus twenty-one names for the server's
   own string-constant and interpolated refusal paths.

   The set is total over the refusals of **requests**, and deliberately not over the
   connection. Four refusals sit below the request layer — a line that is not JSON, a
   first message that is not a hello, a hello whose digest disagrees, and a message
   whose shape is not a request — and carry no class. They are decided before there
   is a request to classify: no method, no element, nothing accessed. Naming them
   would add four members no entry can ever carry.

3. **A seam error the server translates is recorded under the SERVER's name for it.**
   Where the server converts a backend error into its own constant, the record follows
   the caller: the server's constant is what the caller was actually handed.

4. **A class is never recovered by reading a sentence back.** It travels with the
   result, stated where the answer is written, on an internal field that
   `handleRequest` strips in one place before anything reaches the wire. Prose is not
   a category, and parsing it into one is how the leak returns.

5. **The narrowing of an element to identity happens once, inside the audit module**,
   not at each call site. A route hands over the element as it holds it; `identityOf`
   reduces it to id and role on the way to the disk. Asking three call sites each to
   remember the rule makes three places to forget it and a fourth, added later,
   responsible for noticing there was one.

6. **Three call sites, because there are three ways to touch this machine**: an
   element effect (`performEffect`), a launch (which no element verb passes through),
   and a read (all five observe-class methods, at one shared point in `handleRequest`).

### Amendments to ADR-0026

Three, each a divergence from the letter of an accepted decision, recorded here
rather than buried:

- **The told-anyone field is not carried.** ADR-0026 says the record covers, per
  ADR-0022, whether anyone was told. Its subject is a task spanning steps and a person
  who may or may not have been notified — an agent-loop concern that lives in the hub,
  and the hub does not write this record. The daemon knows one effect at a time and
  cannot answer honestly. A field the daemon always fills with the same value is worse
  than no field. **What a task failed to finish IS carried**, as `failed`.

- **The record names what a query ANSWERED, not what it touched.** ADR-0026's wording
  says touched. A query walks up to 150 nodes in an application and 2500 across the
  desktop and answers the few that matched; recording the walk would put the accessible
  name of nearly every element on the desktop into a record whose whole point is
  restraint, and would make the record's size track the desktop's rather than the
  reader's access. The consequence is stated rather than hidden: an element a query
  walked past and discarded leaves no entry.

  *Where the wording ended up.* ADR-0026 said touched, and so did M3's exit box 5,
  and the code has said answered since this record was written. For the whole of M3
  the difference was carried as a disclosure on the tick rather than a correction to
  the box, deliberately: a milestone that edits its own exit criterion while it is
  open cannot be failed by it. When M3 merged, `docs/07-ROADMAP.md` box 5 was
  reworded to say *answered* — the guarantee did not move, the sentence describing it
  did, and this paragraph is where a reader who finds the old wording quoted
  elsewhere can see why. ADR-0026's own sentence is left as written; it is an
  accepted record, and this is the one that narrows it.

- **The seven-key set is frozen, and extending it is an ADR.** A new key means a new
  decision and a changed set assertion, deliberately — not a quiet append.

## Consequences

- **An auditor reading a refusal learns which rule fired, not what the element said.**
  That is less information, on purpose. Someone debugging a refusal reads the daemon's
  answer to the caller, which still carries the full sentence.

- **Adding a refusal path costs more than it used to.** A new refusal must be named in
  the closed set or the build fails. That is the point, and it is friction.

- **`refused:unclassified` exists** for a refusal that reaches the record with no class.
  It is unreachable in a passing build. If it ever appears in a real file it says two
  things, both true: the daemon refused, and it could not name why.

- **A launch refused before its permit check records the caller's own word for the
  application, not the tree name.** Resolving the tree name means reading the catalog
  before authority, which is the capability probe ADR-0019 forbids — the
  launch-authority spies caught exactly this when the call site was first written. So
  the field is recorded at the fidelity the daemon actually had at that moment.

- **What this record does NOT have, as shipped in M3 segment 1:** no encryption at rest,
  no retention limit, no rotation, and the behaviour of two daemons pointed at one
  `--audit` path is unspecified. ADR-0026 names encryption and retention as its own
  answer to the risk of concentrating access history in one file; neither is built here.
  This matters more than it would for an effect-only log, because reads write entries
  too: a file's growth tracks the *query* rate, not the rate at which anything is
  changed, which makes unbounded growth a nearer problem than a design that only
  recorded effects would suggest.

- **Without `--audit` there is no record at all.** A daemon that silently began writing
  an access history to a path nobody named would be the opposite of this ADR's intent.
  The absence of the flag is not a failure; it is a daemon nobody asked to keep a
  receipt.

- **An unwritable sink loses the entry, loudly, and the effect still completes.** Per
  ADR-0022: refusing an effect because the receipt could not be filed causes harm to
  defend bookkeeping. The stderr report carries the entry's identity only — the same
  restraint the entry itself is under.

## Evidence

- `daemon/src/audit.ts` — the entry shape, `REFUSAL_CLASSES`, `identityOf`, the sink.
- `daemon/src/server.ts` — the three call sites: `performEffect`, `openApplication`,
  and the observe branch of `handleRequest`.
- `daemon/src/__tests__/the-audit-log-names-what-was-touched.test.ts` — twelve tests,
  every one driven through the real dispatch over a real backend and read back off the
  disk. None call the audit module directly: a test pointed at the writer proves the
  writer works and proves nothing about whether the daemon calls it.
- Six mutation entries in `tools/mutations.json` (table 57 → 63), each deleting one
  guarantee. Measured on 2026-08-20 via `node tools/mutations.mjs`:
  `the-effect-that-leaves-no-receipt` 6 red, `the-failed-effect-that-leaves-no-receipt`
  1 red, `the-receipt-that-names-the-content` 3 red, `the-refusal-that-goes-unclassified`
  1 red, `the-launch-that-leaves-no-receipt` 1 red, `the-read-that-leaves-no-receipt`
  1 red. Result: `ok - 63 mutation(s), none survived`.
- The failed-effect entry **survived its first run**, which was accurate: nothing tested
  the path where a route throws something nobody classified. The test was written rather
  than the entry dropped.
- `.mastracode/plans/m3-the-hub-thinks.proof/segment-1/` — the red/green pair: the same
  effect at the merge base, where the flag does not exist, and on this branch, where the
  receipt names the element the daemon answered on the wire.

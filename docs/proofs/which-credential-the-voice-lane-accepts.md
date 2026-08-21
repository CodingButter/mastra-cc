# Which credential the voice lane accepts, and what it does with the rest

M3's claim is "an agent that can drive the daemon, with credentials it never
hands out." The credential half of that sentence is the one that can quietly be
false: a hub that mints a token at boot and reuses it, or one that blames the
account for a failure it never observed, still passes every test that only asks
whether audio came out. So the question this document answers is narrower than
the milestone and sharper than it:

> **What credential does the voice lane accept, and what does it do with
> everything else?**

Four legs answer it — one dial that succeeds, and three ways of saying no. The
falsifiable version of the milestone's whole claim is the exit gate in
[07-ROADMAP.md](../07-ROADMAP.md); this is the receipt behind box 4.

Provenance is stated **per measurement**, not once for all. The four segments
were scored by different witnesses under different tree states, and a single
convention sentence covering all of them would be false of some — which is the
overclaim this milestone was built to catch.

Full transcripts live beside the plan that produced them, in
`.mastracode/plans/m3-the-hub-thinks.proof/segment-N/`, on the desk that ran
them: they carry live-desk session detail that does not belong in a committed
document. What is quoted below is verbatim from a transcript that exists, with
the artifact named — M2.7's receipt once quoted a verdict line a superseded
script had never produced, which is a nicer story than the truth.

## The answer, in one line

The voice lane accepts **exactly one credential: the key held by the hub for
the `google` account, read at the moment of the dial.** Everything else — an
absent account, a key the provider rejects, a failure the lane cannot
attribute, a token that outlived its window, and a key a caller presents — is
refused by a name that says which of those it was.

**Fetching the commits these legs name.** Every segment's transcript stamps the
branch-point build it ran, not the squashed commit that landed on `master` — so
none of `d3ad210` (S1), `634668e` (S2), `a3cbc8e` (S3) or `964fa6c` (S4) is an
ancestor of `master`, and a cold reader checking one out will not find it by
`git log` alone. They remain reachable from their pull requests' head refs,
checked 2026-08-21: `git fetch origin refs/pull/37/head` reaches `d3ad210`, and
`38`, `39`, `40` reach the other three respectively. Raised by the whole-feature
review, which could see the mismatch and could not run git to resolve it.

## Leg 1 — a real dial, on a token minted for it alone

**Provenance.** Environment: minibeast, Wayland, no display (this lane has no
window). Tree state: clean at `964fa6c`. Commit under test: `964fa6c`. Witness:
an out-of-process client standing in for the *device*, holding nothing but the
minted token and collecting the provider's own session frames — the hub's log
lines are read only as secondary evidence, and the turn is scored by the
provider, not by the hub's report of itself. Model: `gemini-2.5-flash-native-audio-latest`,
pinned because it is reachable on this account today (`gemini-3.1-flash` 404s).

From `green.txt`:

```
green-events: open,setup-complete,message,message,message,turn-complete,close
tokens-differ: yes
leg-verdict: a turn completed on a minted token
```

and the two claims that make it a *credential* proof rather than a liveness one:

```
- two dials produced two DIFFERENT tokens against the real mint - the lane keeps none
- the lane logged THAT it minted, never WHICH token
```

The long-lived key never leaves the hub. What travels is a single-use token
minted for one dial, and the second dial proves the first token was not kept:
a lane that cannot remember a token cannot reuse one.

## Leg 2 — no account attached: `409 NO_GOOGLE_ACCOUNT`

**Provenance.** Same host and commit; the credential store is empty for this
leg by construction, so nothing was dialled. Witness: the refusal itself plus
a captured log sink whose line count is asserted.

From `no-account.txt`:

```
refusal-status: 409
refusal-code: NO_GOOGLE_ACCOUNT
refusal-text: voice: 409 NO_GOOGLE_ACCOUNT - no credential is attached to the "google" account, so no token can be minted for a dial; attach one to that account
- 409, not 401 - nothing was rejected, there was nothing to reject
- exactly one line - the lane refused without dialling anything to find out
```

The distinction between 409 and 401 is the whole point: an absent credential is
not a rejected one, and the remedies differ.

## Leg 3 — a credential the provider rejects: `401 CREDENTIAL_REJECTED`

**Provenance.** Same host and commit. The 401 is real: a malformed key was sent
to the live mint endpoint and the provider answered. Witness: the provider's
own status, relayed; the attempt count, asserted.

From `bad-key.txt`:

```
refusal-text: voice: the provider answered 401 (CREDENTIAL_REJECTED) - the "google" account's credential was not accepted, and a rejection is not retried; the provider's own message is not carried here
- the provider's prose stayed behind and the refusal says so
- ONE attempt - a rejection is not retried, so the account is not hammered
```

The provider's real prose for this case is
`Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.`
It is pinned verbatim in the test file so the sanitiser is asserted against
actual prose rather than a paraphrase, and it does not travel: a provider's
error text can quote the request back, and the request is the user's.

No retry, deliberately. ADR-0006: a retry loop around a 401 hammers an account
into a lockout.

## Leg 4 — a token that outlived its window, seen on the close

**Provenance.** Same host and commit. The wait is real elapsed time —
`expiry-wait-ms: 150000`, roughly two and a half minutes — and is not
simulated, because a simulated expiry proves the simulation. Witness: the
provider's close frame, carrying its own reason.

From `expired.txt`:

```
expired-events: open,close
expired-close-reason: Token has expired
expired-close-verdict: expired-remint
- the expiry arrived on the CLOSE of a session, not on the dial
- the lane reads that close as re-mint, not as fix-the-account - different remedies, kept different
```

This is the leg that justifies a fourth outcome rather than folding expiry into
rejection. An expired token **opens the socket and is then closed by the
provider**; a bad key never opens one. The remedy for the first is to mint
again, and for the second to fix the account.

## The red leg — the same script against the build before the change

**Provenance.** The same `demo.sh`, unmodified, pointed at a worktree built
from the merge base `268706b`; the transcript stamps the commit of the *build*
it ran, not of the script. A described base is a base nobody ran.

From `without.txt`:

```
commit:  268706b (the build under test)
voice-lane: ABSENT from this build - undefined
PROOF: RED - see the check above
```

The red is red for the reason claimed — the lane does not exist at base — and
not for a missing module or a stale artifact, both of which produced false reds
during this segment and were fixed before the transcript was kept.

## What none of this establishes

Three gaps, stated because a receipt that only lists its greens is an
advertisement.

**1. The licence gate passes by omission.** M3 added three dependencies
(`@mastra/core`, `@mastra/memory`, `@google/genai` — all Apache-2.0, all
approved). `tools/licences.mjs` checks *declared* dependencies only, so the
transitive tree those three drag in is not scored by the gate. The runtime tree
was measured by hand instead: three BlueOak-licensed transitives
(`@isaacs/ttlcache`, `lru-cache`, `sax`). That measurement is a person reading
a tree, not a check that will notice when the tree changes. Tracked as issue
\#36.

That list was the whole disclosure in the first version of this document, and
the whole-feature review was right that it undersold the gap. Two more things
the declared-only gate does not see, both verified at source rather than
inferred:

- `json-schema@0.4.0` declares `(AFL-2.1 OR BSD-3-Clause)`. It reaches the tree
  under `@mastra/core` and `@mastra/memory` (`pnpm-lock.yaml:1789`, `:1816`).
  AFL-2.1 is **not** on the allowlist at `tools/licences.mjs:14`; the package
  passes only because `licenceAllowed()` accepts an `OR` if either side is
  allowed, and the BSD side is. That is the correct reading of a dual licence,
  but it means a non-allowlisted licence name is admitted by a branch nobody
  exercised deliberately. (This bullet said "the tree's **only** non-allowlisted
  licence name" until the review pointed at the next bullet, which names another
  one. The word was wrong by exactly the overclaim this section exists to
  prevent, and there is no scope in which it was true.)
- `lightningcss` and its native variants declare MPL-2.0, reaching the tree
  through `vite`. Dev tooling, outside anything M3 ships, and equally invisible
  to a gate that reads manifests.

Neither is a violation. Both are things a receipt claiming to state its licence
gap should have named the first time, and the honest version of gap 1 is that
nobody knows what else is in there — three names were measured, not "three is
the answer". Issue \#36 is about replacing the person with a check that walks
the installed closure; [the roadmap's own M5 entry](../07-ROADMAP.md) records
the sharpest instance of why (openWakeWord ships Apache-2.0 code with
CC BY-NC-SA weights, and a gate reading manifests would have passed it).

**2. The token's lifetime is enforced upstream and is not readable.** The hub
requests a two-minute window at mint. The mint response carries only a name —
no `expireTime`, verified twice against the live endpoint — so the hub cannot
confirm the window it asked for was the window it got. Leg 4 shows an expiry
arriving, which proves *a* limit exists and is enforced; it does not prove the
limit is the one requested. The code says so where it matters: a number nobody
can check is not a guarantee.

**3. Which greens were scored by the subject's own report.** Legs 1–4 are
scored by an out-of-process client and the provider's own frames. But the
refusal legs necessarily read the hub's refusal object — there is no third
party to a sentence the hub declines to say. The log-sink assertion is the
partial answer: it asserts what is *absent* from a captured sink after asserting
the sink is non-empty, because a silent lane is not a lane that keeps secrets.

**And one thing that is out of scope rather than unproven:** the voice lane is
exported and, in this milestone, invoked only by tests and by the proof client
driving the built artifact as a library. Nothing in the hub's own entry point
dials it. That waits on a client, which is M4 — the same reason boundary pin B3
ships with only its runtime half wired.

## Commands

```
# the four legs, one at a time; the expired leg takes ~2.5 minutes of real time
PROOF_LEG=no-account .mastracode/plans/m3-the-hub-thinks.proof/segment-4/demo.sh no-account
PROOF_LEG=bad-key    .mastracode/plans/m3-the-hub-thinks.proof/segment-4/demo.sh bad-key
PROOF_LEG=green      .mastracode/plans/m3-the-hub-thinks.proof/segment-4/demo.sh green
PROOF_LEG=expired    .mastracode/plans/m3-the-hub-thinks.proof/segment-4/demo.sh expired

# the red: the same script, a base build
HUB_DIST=/tmp/m3-s4-base/apps/hub/dist/index.mjs PROOF_LEG=green \
  .mastracode/plans/m3-the-hub-thinks.proof/segment-4/demo.sh green
```

Each transcript asserts, before it is written, that nothing bearer-shaped
appears in the leg's raw output — matched by pattern class rather than against
a known sample, because a detector that only recognises the token it was shown
is a reminder, not a detector. A transcript is a log, and ADR-0006 says a token
in a log file is a token.

The segment's own PR is [#40](https://github.com/CodingButter/mastra-cc/pull/40).

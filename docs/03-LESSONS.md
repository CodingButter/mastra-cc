# 03 — Lessons

**What this is:** an honest post-mortem of the `computer-controls` prototype — 332 commits, 127 pull requests, 105 issues, seven days — organised by *failure family*, with the rule each family buys. The ADRs in [02-DECISIONS/](02-DECISIONS/) are the decisions; this document is the pain that produced them.

**Read this before you disagree with an ADR.** Most of them look over-engineered until you know what they cost.

---

## The headline

**Rework was the constraint. Throughput never was.**

The prototype produced 332 commits in seven days across as many as nineteen parallel agents. That output was not the problem and more of it would not have helped. What hurt was:

| Signal | Number |
|---|---|
| Merge commits, out of 332 | 106 |
| Revisions of the single most-churned file | 34 (`desktop_service/server.py`) |
| Revisions of the file declared "frozen" on day one | 23 (`protocol/schema.json`) |
| Copies of the same seven live modules | 3 |
| Commits prefixed `fix:` | 29 |

One number deserves a correction, because getting it right matters more than the rhetorical value of getting it wrong. An earlier reading of this history claimed "53 of 332 commits are reverts or rework." **There are zero true revert commits.** What exists is 29 `fix:`-prefixed commits plus a set of prose-titled corrections and superseded pairs. The honest statement is: *a meaningful minority of commits existed to correct a previous commit*, and the pattern is visible in the pairs — `c99b279` consolidated as `36cfa9d`, `b003745` merged as `dfc124c`, `170a999` a band-aid later cut by `5f389bc`.

This correction is itself lesson zero: **check the number before you use it in an argument.**

---

## Family 1 — Facts that lived outside the repository

**The most dangerous class, because no test in the tree can see them and the system looks healthy while broken.**

### 1.1 A setup command in a database column

The provisioning command for every new agent sandbox was stored in `factory_project_repositories.setup_command`. The day-seven reshape (PR #227) renamed top-level directories; the command still said `cd plugin`. Every *new* sandbox failed. Every *existing* worker kept running.

The result is the worst possible shape of failure: **the fleet looked fully healthy and was structurally unable to grow.** Every repository gate passed. It was found only by trying to dispatch new work.

### 1.2 A maintenance script in `~/bin`

A cron job ran `~/bin/factory-keeper.sh` every fifteen minutes. A pull request (#225) had replaced it with a tested, gated version. The replacement was never installed. For an entire evening the old script re-woke already-finished work every fifteen minutes.

The claim *"the re-dispatch loop is fixed"* was **true in code and false in production** for six hours. When the fixed version was finally deployed, it refused 31 of the 34 rows the old one would have woken.

### 1.3 A memory ceiling in a systemd unit

The service OOMed at roughly 4 GB, three times, while systemd continued to report it as `active`. The fix was one environment line in a unit file on one host. Nothing in the repository recorded that this line was load-bearing.

### 1.4 An install method that could not work

PR #225 *did* put its script in the repository — and documented installing it by symlink into `~/bin`. `BASH_SOURCE[0]` resolves through a symlink, so the script computed its repository root as `$HOME` and died on `cd`. Being in the repo is necessary and not sufficient: **the script must also be exercised the way it is installed.**

> ### The rule
> **Every machine-side fact lives in `infra/`, in the repository, applied by a checked-in script that is tested the way it is installed.** A rename PR greps out-of-tree configuration for old paths before merging, and proves itself by provisioning one fresh environment after. → [ADR-0001](02-DECISIONS/0001-machine-config-lives-in-the-repo.md)

---

## Family 2 — Guessing instead of reading

**Cheap to avoid, expensive every single time.**

### 2.1 The board enum

Advancing a work item required a `board` field. The value being sent was `"default"`. The parser accepted exactly two values: `"work"` and `"review"`. Every transition returned 400 for hours, across multiple probing attempts with different body shapes — all of them guesses.

The fix took two minutes once the actual parser was read. The lesson is the method: **read the parser, not the docs, and definitely not your intuition about the payload.**

### 2.2 Twelve kickoffs blamed on a human

Two issues sat at intake for approximately twelve kickoff cycles each. The diagnosis, repeated by the agents themselves and accepted by the operator, was *"an enhancement must be promoted by a human."* It was not true. The transition API accepted the promotion immediately once the correct board string was sent.

**The human was a typo.** Twelve cycles of agent capacity were spent waiting for a person to do something no person needed to do.

### 2.3 A filter that silently matched nothing

A re-dispatch script was invoked as `factory-kick.mjs only 188`. The script expected a bare number. `Number("only")` is `NaN`, the filter condition silently evaluated false, and the *entire board* was re-kicked — twice.

The script now refuses a bad argument loudly. **A filter that cannot parse its input must refuse, never default to "everything".**

### 2.4 A claim about the fleet that was wrong twice

When the fleet stalled, the first diagnosis was an OOM. It was not — the fatal-error line in the log was from an earlier restart, and the process was sitting at 2.9 GB against a 12 GB ceiling. The second diagnosis was that one malformed message part had poisoned every agent's memory processor. Also wrong: observational memory is scoped per resource, so a bad part in one thread could only ever affect that thread.

The correct answer was mundane — the keeper had woken agents who correctly found nothing to do and dismissed themselves. Finding it required **reading each agent's last actual sentence** rather than counting messages.

> ### The rule
> **Read the source of truth before forming a theory.** Parser over documentation. Last sentence over message count. Log line over log timestamp. And when a theory is wrong, retract it explicitly and out loud — two wrong diagnoses stated confidently cost more trust than the outage did.

---

## Family 3 — Duplicated truth

### 3.1 Three copies of seven modules

The ear chain, fingerprint matcher, gate, and session dial existed as TypeScript source in the hub, as emitted JavaScript in a public directory, and as a vendored copy inside the Electron widget. Two generator scripts kept them aligned and parity tests caught drift.

The parity tests worked — one caught a hand-edit made directly to the vendored copy during live debugging. That is the system succeeding, and it is also the point: **the drift kept happening, so the tests kept being needed.** Every change in that area cost three files and a regeneration step.

### 3.2 Two daemon clients, one of them drifted

The hub wrote its own daemon client rather than use the plugin's. By the time they were laid side by side during the reshape, the hub's copy **located the socket by scanning filenames** and **skipped the schema digest check** — the exact mechanism that prevents version-mismatched clients from connecting.

Nobody knew. It had been running in production.

### 3.3 Generated code committed alongside its source

`schema.json` (23 revisions) dragged `schemas.generated.ts` (24), `protocol_generated.py` (23), and `protocol.generated.ts` (23) with it. Reviewers learn that three of four files in a protocol diff are noise, and then they stop looking.

### 3.4 A dependency that outlived its code

The widget's transcriber was deleted — seven files, 80 MB. Its dependency declaration was not. `@huggingface/transformers` is still the widget's only runtime dependency at the pivot, because the boundary test that proves the transcriber is gone greps *source files*, not the manifest.

> ### The rule
> **One implementation per concept, in one package, from commit one.** Generated code is build output ([ADR-0009](02-DECISIONS/0009-generated-code-is-build-output.md)); the transport is a shared package ([ADR-0003](02-DECISIONS/0003-one-shared-transport-package.md)); and a boundary test that checks source must also check the manifest, or deleting code will not delete the dependency.

---

## Family 4 — Rules that were prose

### 4.1 The freeze

`protocol/schema.json` was frozen on day one at 04:03, in a commit that says so: *"freeze desktop control protocol v1.0 with generated bindings and compatibility suite."* Twenty-two further commits changed it, the last on day four (*"Report a browser the accessibility layer cannot read as running, not as absent"*). Nothing failed because nothing could: the freeze was a sentence.

Several of the changes were *good*. That is not the point. The point is that changing it cost nothing, so nobody had to decide whether it should change.

### 4.2 A boundary rule that was habit

The widget had a boundaries suite enforcing one audio-device consumer per process. When the dashboard gained audio capture, it turned out the widget's suite had never covered the dashboard package — the rule was, in the words of the PR that fixed it, *"habit, not a rule."*

The fix added a source-level test to the dashboard **that asserts its own file list is non-empty**, so a glob matching nothing cannot pass vacuously and report success.

### 4.3 A test suite that was green while the build was broken

A package's tests and typecheck both passed while the production build failed, because the bundler needed alias configuration the test runner did not read. **A green suite is not a green build.**

> ### The rule
> **A rule with no failing test is a wish.** Every boundary in [01-ARCHITECTURE.md §5](01-ARCHITECTURE.md) has a test; the schema freeze is a CI job ([ADR-0002](02-DECISIONS/0002-schema-freeze-is-a-ci-job.md)); source-level tests assert their own coverage is non-empty; and the build is a separate gate from the tests.

---

## Family 5 — Parallel work against a moving shape

### 5.1 The merge tax

106 of 332 commits are merges. Pull requests exist whose entire purpose is repairing a main branch broken by two independently-clean merges — PR #136's title says exactly that. Nobody chose to spend that time.

### 5.2 Two correct designs colliding

PR #221 and PR #228 independently diagnosed the same root cause about the widget window. One worked around it with a demo mode; the other fixed it outright. Merging them required hand-reconciling a genuine semantic conflict — a capture rectangle designed to narrow a photograph *inside* a display-sized window, meeting a change that made the window *be* the orb's box.

Both were right. The conflict was structural, not a mistake by either author.

### 5.3 A reshape landing under five in-flight branches

PR #227's 135 renames merged while five agents were working inside the renamed directories. Each hit file-location conflicts on its next pull. The reshape also broke out-of-tree provisioning (§1.1).

### 5.4 Dispatch before cleanup

Nineteen issues were dispatched roughly three minutes *before* the stale board cards were cleaned. The result: six agents working on issues whose pull requests had already merged, and an hour spent explaining redundant work.

To the agents' credit, all six read their own state and self-terminated correctly without intervention. The stop condition worked. The dispatch order did not.

> ### The rule
> **Settle the architecture with one author before running many.** Parallel agents are excellent against a stable shape and expensive against a moving one. Clean the board, then dispatch. → [ADR-0015](02-DECISIONS/0015-one-vertical-slice-before-parallel-agents.md)

---

## Family 6 — Building on an unmeasured foundation

### 6.1 The transcriber

Days went into on-device transcription for wake detection. It failed *at the source*: the recogniser turned "hey mastra" into **"He master."** A band-aid that also accepted "he" shipped before the approach was abandoned.

The tell was available early. Nobody measured the recogniser's output on the actual phrase before building matching logic on top of it.

### 6.2 A ceiling justified by an instrument

A depth ceiling shipped with a stated justification that turned out to be derived from an **instrument setting**, not from measured behaviour of the accessibility layer. To the prototype's credit, this was retracted in public as its own issue — *"name the real one — our depth ceiling"* — and replaced with a principle that survives.

### 6.3 A threshold raised twice

The wake threshold went from 18 to 20 because live captures kept landing just outside. On the live microphone the enrolled speaker still scored 20.4–21.3 against their *own* templates, while those templates sat 12–18 apart from each other.

That is a systematic offset, and the suspect is that the enrolment rig and the live gate are two separately-written capture paths of which only one was ever measured. **Raising a threshold to admit the measurements you have is how you stop noticing that the measurement is wrong.**

### 6.4 The face got attention the north star did not

Four consecutive commits in one night refined the orb's visual design — glass shell, wisps, a glowing letter, then thicker smoke and a brighter reflection — before *"tell me my most recent email"* worked end to end.

> ### The rule
> **Measure the foundation before building on it, and never tune a constant to hide an inconsistency upstream.** Every milestone in [07-ROADMAP.md](07-ROADMAP.md) has a verification gate that can fail, and visual work is scheduled after the sentence works.

---

## Family 7 — Queues, and what "sent" means

The re-dispatch loop deserves its own section because it burned the most capacity and the root cause generalises well beyond this project's tooling.

A queue row marked `sent` means *delivered*. It does not mean *done*. The keeper read `sent` as "still owed" and re-woke it. Meanwhile the run it belonged to could not reach a terminal state, because the kickoff payload was frozen at run start and the agent's skill was not permitted to request the transition that would have ended it. So the row stayed `sent`, forever, and the keeper woke it every fifteen minutes.

One work item was re-dispatched nine times in two and a half hours. Two others reached their eleventh and twelfth kickoffs.

The fix that landed (PR #225) is a good model for this class of problem:

- **Gates are pure functions**, tested by inverting each one and requiring red.
- **Cheap structural checks run first**, so a row refused for being litter never triggers a network lookup.
- **The "is someone typing in this thread" check runs last**, so a permanently-dead row is reported as permanently dead even while its thread is active.
- **Two gates deliberately fail open** — an unknown role and a failed lookup both mean "unknown", never "closed". Gating on ignorance was explicitly refused.
- **A card on more than one board returns no answer**, and refusing to judge is the safe direction.

> ### The rule
> **A delivered message is not a completed job.** Any requeue mechanism must distinguish the two, must fail open on ignorance, and must be testable by inverting each of its gates.

---

## What went right, and must not be lost in the rebuild

The prototype was not a failure. Carry these forward without renegotiation:

| What | Why it mattered |
|---|---|
| The semantic-first bet | Held across GTK3, GTK4, Qt, Electron for seven days |
| Attributed effects | Makes "the human outranks the agent" enforceable, not aspirational |
| Proof artifacts | Claims a stranger can re-run; a proof that cannot prove writes nothing |
| Mutation testing on load-bearing rules | Each guarantee broken on purpose and watched go red |
| Parity tests | Caught a hand-edited vendored file during live debugging |
| Refusals that explain themselves | Turned "no" into a debuggable answer |
| Honest limits in PR bodies | *"Live conversation not exercised: needs a real desktop, a mic, and a person"* |
| Rebasing before claiming mergeable | *"A PR mergeable an hour ago is a claim, not a fact"* |
| Fail-open gate design | Refusing to gate on ignorance |
| Retracting a wrong claim immediately | The depth ceiling; the fleet-wide poisoning theory; the "53 reverts" number in this very document |

That last row is the one that matters most. The prototype's best habit was saying *"I was wrong, here is the accurate framing"* without ceremony, quickly, in public. Keep it.

---

## Receipts

| Claim | Source |
|---|---|
| 332 commits / 106 merges / 226 non-merge / 29 `fix:` / 0 reverts | `git rev-list` and `git log --grep` on `computer-controls` |
| `server.py` 35, `schema.json` 23, generated files 23–24 | `git log` per-path counts |
| setup command in a DB column; `cd: can't cd to plugin` | 2026-08-07 18:38 |
| keeper fixed in PR #225, deployed 2026-08-07 21:17; refused 31 of 34 | keeper dry-run and live log |
| OOM at ~4 GB ×3; 12 GB ceiling in a unit file | service logs; systemd unit |
| symlink defeats `BASH_SOURCE` root | `bash -x` trace, 21:16 |
| board enum is `work` / `review` | transition API `parseTransitionBody` |
| two issues stuck ~12 kickoffs, unblocked by the correct board string | issues #188, #189; transitions 200 at 2026-08-08 01:52 |
| `Number("only")` = NaN re-kicked the whole board | `factory-kick.mjs` argument handling, 2026-08-07 18:35 |
| stall was not OOM and not fleet-wide poisoning | 2.9 GB RSS; per-resource memory scoping; 2026-08-07 22:30–22:38 |
| three copies of seven live modules; parity test caught a hand-edit | `face-parity.test.ts:53` |
| hub's daemon client found the socket by filename, skipped the digest | PR #227 |
| widget still declares `@huggingface/transformers` after the cut | `clients/widget/package.json`; boundary test greps source only |
| freeze at 04:03, 8 later changes, last `6657915` | `git log -- protocol/schema.json` |
| boundary rule was "habit, not a rule"; non-empty file-list assertion | PR #226 |
| green tests, broken build; Turbopack alias fix | commit `0eade11` |
| main broken by two clean merges | PR #136 |
| #221 / #228 semantic conflict | PR #228 merge resolution |
| reshape under five in-flight branches | branch probe, 18:27 |
| dispatch three minutes before board cleanup; six agents on merged work | 2026-08-07 17:56–18:13 |
| "He master."; band-aid `170a999`; cut `5f389bc` | wake debugging, 13:17–17:45 |
| depth ceiling rested on an instrument setting | issue #42 |
| threshold 18 → 20; live 20.4–21.3; templates 12–18 apart | `fingerprint.ts:64`; live session 2026-08-08 02:09 |
| four orb visual commits in one night | 2026-08-04 |
| one item re-dispatched 9× in 2.5 h; 11th and 12th kickoffs | keeper analysis; agent logs |
| PR #225 gate ordering, fail-open, mutation tests | `scripts/factory_keeper/gates.py`; `test_factory_keeper_mutation.py` |

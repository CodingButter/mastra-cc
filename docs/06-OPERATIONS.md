# 06 — Operations

**Scope:** how this project is run — the machines, the agent factory, version pinning, and the incident runbooks that were written in blood during the prototype week.

**Governing principle, and it is the whole document in one line:** every fact below that a machine depends on must live in `infra/` in the repository. → [ADR-0001](02-DECISIONS/0001-machine-config-lives-in-the-repo.md)

---

## 1. Machines

| Host | Role |
|---|---|
| **bigbeast** | the desk. Ubuntu 24.04 LTS, GNOME 46, X11, RTX 4090. Runs the daemon, hub, and widget. **The only host where live desktop proofs can be produced.** |
| **dev-beast** | the factory. Runs the agent-factory service, its Postgres, its Redis, and the keeper cron. |

**The host-split trap.** The factory service, its logs, and its database live *only* on dev-beast. Running `systemctl`, tailing the log, or opening `psql` on bigbeast produces output that looks like a dead service and is in fact a wrong host. The prototype lost time to this more than once. **Every factory command in this document runs over SSH to dev-beast.**

**Database access is through the container, not the host.** A local `psql` on bigbeast connects to a different Postgres entirely and reports that the role does not exist — which reads as a credentials problem and is a wrong-target problem.

Credentials and connection details live outside the repository. `infra/` records *where* they live; it never records the values.

---

## 2. Version pinning

**The rule: pin the agent-factory toolchain to a known-good release and bump it deliberately, never incidentally.**

The reason is specific and repeated: the prototype carried local patches to the factory packages, applied by pnpm and keyed to exact versions. **Every version bump silently dropped every patch.** Nothing failed loudly. The service started, ran, and behaved subtly differently.

**Procedure for any factory dependency bump:**

1. Note the current versions and the patch set before touching anything.
2. Bump.
3. **Re-apply the patches** — they are keyed to exact versions and will not carry over.
4. Verify a patch sentinel is present in the installed files, not merely that the patch step reported success.
5. Restart, and confirm the service came up on the new version.

Jamie's standing direction from the pivot applies here: **set the factory back to the most recent stable release and pin it there.** A rebuild is not the time to be tracking a moving agent platform.

**Pinned versions live in `infra/`**, with a comment naming why each pin exists. A pin without a reason gets bumped by the next person who reads it.

---

## 3. The board

Work moves through stages on boards. The vocabulary is exact and **the enum is not guessable** — this cost the prototype hours and blocked two issues for roughly twelve kickoff cycles each.

**Boards:** `work`, `review`. Those two, exactly. Sending anything else — `default`, for instance — returns 400 for every payload shape you try, and the error does not tell you which field is wrong.

**Stages:** `intake`, `triage`, `planning`, `execute`, `review`, `done`, `canceled`.

**A transition requires:** the board, the target stage, a request id, a short cause, and the item's expected revision. Extra keys are ignored by the parser.

**Three operational facts, all learned the hard way:**

- **The board does not advance itself when a pull request merges.** Cards for shipped work sit in `review` indefinitely and look like a backlog. They are phantoms; advance them explicitly.
- **A card that appears on more than one board has no single current stage.** The safe behaviour is to refuse to judge rather than pick one.
- **When a transition is rejected, read the parser.** The prototype's entire "a human must promote this" theory was a wrong enum string. → [03-LESSONS.md §2](03-LESSONS.md)

---

## 4. Dispatch

Dispatching an issue to an agent is two calls: create a session on the issue's branch, then start a run bound to that session and work item.

**Rules, each of which corresponds to a prototype failure:**

1. **Check capacity first.** There is a maximum in-flight dispatch count and a maximum sandbox count, and they are different numbers. The prototype ran with in-flight at 10 against a sandbox ceiling of 32, which meant roughly half of nineteen dispatched issues were queued at any instant. **That is not a stall**, and it repeatedly looked like one.
2. **Clean the board, then dispatch.** Dispatching before clearing stale cards produced six agents working on already-merged issues.
3. **A dispatch script's argument parser must refuse bad input.** `Number("only")` is `NaN`; a filter that silently evaluates false re-kicks the entire board. Twice.
4. **A `202` is a promise, not a running agent.** Verify the agent actually spoke before reporting the dispatch as successful.
5. **Sandbox provisioning runs a setup command that lives outside the repository.** Under [ADR-0001](02-DECISIONS/0001-machine-config-lives-in-the-repo.md) that command must be a path to a script in `infra/`, never an inline copy of its contents. When the prototype's inline copy went stale after a rename, new sandboxes failed while running agents were unaffected — the fleet looked healthy and could not grow.
6. **Make the setup script layout-agnostic anyway.** Old branches carry the old tree. The prototype's fix detects which layout it is in and adapts, which is what let old and new branches provision from one command.

---

## 5. The keeper

The keeper is a periodic job that looks for genuinely stalled work and re-wakes it. It is worth describing in detail because its failure mode was the single largest capacity drain of the prototype week, and the root cause generalises.

### The bug it exists to prevent

A queue row marked `sent` means *delivered*. It does not mean *done*. The original keeper read every young `sent` row as still-owed work and re-woke it. Meanwhile the run it belonged to could not reach a terminal stage, because the kickoff payload was frozen at run start and the agent's skill was not permitted to request the transition that would have ended it.

So the row stayed `sent` forever, and the keeper woke it every fifteen minutes. **One work item was re-dispatched nine times in two and a half hours.** Two others reached their eleventh and twelfth kickoffs.

### The design that fixed it

A pure decision function over ordered gates. Each gate returns a refusal or falls through; the last case requeues.

| Order | Gate | Kind |
|---|---|---|
| 1 | binding revoked | permanent |
| 2 | row older than the maximum age | permanent |
| 3 | work item missing | permanent |
| 4 | item at a terminal stage | permanent |
| 5 | issue closed | permanent |
| 6 | payload role mismatch | permanent |
| 7 | role/stage mismatch | permanent |
| 8 | no payload | refuse |
| 9 | thread active within the activity window | skip this tick |
| — | otherwise | requeue |

**Four properties worth copying verbatim into any future requeue mechanism:**

1. **Cheap structural facts first**, so a row refused for being litter never triggers a network lookup.
2. **The "is somebody typing in this thread" check runs last**, so a permanently-dead row is reported as permanently dead even while its thread is active.
3. **Two gates deliberately fail open.** An unknown role and a failed issue lookup both resolve to *unknown*, never to *closed*. Gating on ignorance was explicitly refused.
4. **A card on more than one board yields no answer**, and refusing to judge is the safe direction.

Everything above is a pure function with no database and no network, so it is unit-testable and mutation-testable — the mutation suite inverts each gate and requires red.

### Deployment

**The keeper is the canonical example of [ADR-0001](02-DECISIONS/0001-machine-config-lives-in-the-repo.md), because it failed that rule twice in one evening:**

- The fixed keeper shipped in a pull request and **was never installed**; cron kept running the old script for six hours.
- The documented install method used a symlink, and the script computed its own root through the symlink, landing in `$HOME` and dying on `cd`.

Both are `infra/` problems. The keeper is installed by `infra/apply.sh`, the script resolves symlinks when computing its root, and installation is verified by running the installed path and reading its log — not by reading the pull request.

**Reading the keeper's output:** verdicts go to a log file, not to stdout. A silent exit 0 is normal. Read the log.

---

## 6. Incident runbooks

### 6.1 The fleet looks stalled

**Do not guess.** The prototype guessed twice and was wrong twice.

1. **Measure liveness over more than one window.** Agents think for two to three minutes between messages, so a five-minute window shows a fraction of a fifteen-minute window. A five-minute count of 5 against a fifteen-minute count of 19 is a healthy fleet, not a dying one.
2. **Check capacity before pathology.** In-flight limit versus sandbox limit (§4.1). Half the fleet queued is normal.
3. **Read each agent's last actual sentence.** Not the message count, not the timestamp — the words. The prototype's "stall" turned out to be agents who had been woken, correctly found nothing to do, and dismissed themselves.
4. **Only then look for a crash.** And check that the fatal line in the log is from *this* run and not from a restart three hours ago.

### 6.2 Out-of-memory

The service can exhaust its heap while systemd continues to report it as `active`. Symptoms: the studio hangs, liveness probes return zero, and the log ends on a heap-limit fatal error.

Fix: raise the Node heap ceiling in the unit file, reload, restart. **The ceiling lives in `infra/systemd/`** with a comment naming this incident, because the prototype's lived on one host and would not have survived a rebuild.

### 6.3 Restarting the factory

A restart kills agents mid-turn. The prototype measured that cost at roughly two and a half hours of lost work, so it is a decision, not a routine action.

**Before:** verify no dependency bump is pending, confirm the local patches are present in the installed files, and check the heap ceiling is in the unit environment.

**After:** bound sessions are not resident in the controller following a restart, so kickoffs fail with a not-found error until sessions are re-materialised. Run the re-kick procedure, then verify the fleet is back above its floor.

### 6.4 A rename PR

1. Grep **out-of-tree** configuration for the old paths — setup commands, unit files, cron entries, CI job definitions.
2. Merge when no parallel work is in flight, or accept that every in-flight branch will hit file-location conflicts on its next pull.
3. **Prove it by provisioning one fresh environment.** Not by a green test suite; the test suite cannot see the thing that breaks.

---

## 7. Known upstream defects

Two defects in the agent platform were identified with evidence during the prototype and are owed as upstream filings. Recording them here so they are not rediscovered:

1. **A fresh unique key is generated per kickoff delivery**, which defeats the coalescing that the unique constraint exists to provide. Duplicate kickoffs accumulate instead of collapsing.
2. **The kickoff payload is frozen at run start**, so a skill cannot request a transition past its starting stage. The run therefore cannot reach a terminal state, the queue row stays `sent` forever, and any keeper re-wakes it indefinitely. **This is the structural cause of the loop in §5.**

Also watched, recurring, and not yet root-caused:

- A token-counting error on a malformed tool-invocation part that permanently breaks one thread's memory processor. One malformed part among roughly 6,700 bricked a single thread. The blast radius is one thread, not the fleet — an early claim to the contrary was wrong and was retracted.
- A provider error when an assistant message ends on a reasoning block, which makes the affected thread terminal: every replay dies at the same index.
- A scorer rate limit that pauses evaluation runs, seen five times in one evening.

---

## 8. Working agreements

These are Jamie's standing directions and the practices that follow from them. They are operational, not stylistic.

- **Report outcomes, not intentions.** Do not wait for acknowledgement before acting.
- **Never claim an unobserved result.** If it was not verified, say what was verified and what was not.
- **Never nudge maintainers** on pull requests or issues.
- **Never kill a live desktop application with `kill -9`.** Kill the exact process; stale processes interfere because there is no single-instance lock.
- **Restore a mutation by reversing the exact edit.** Never `git checkout <file>` unless the file was committed first.
- **A pull request mergeable an hour ago is a claim, not a fact.** Rebase before opening one.

---

## Receipts

| Claim | Source |
|---|---|
| host split; factory service/log/DB only on dev-beast | repeated observation, 2026-08-07 |
| local `psql` targets a different Postgres and reports a missing role | 2026-08-07 21:12 |
| version bumps silently drop local patches | pnpm patched dependencies keyed to exact versions |
| pin the factory to a stable release | Jamie, 2026-08-08 02:11 |
| boards are `work` and `review`; stages are the seven listed | transition API `parseTransitionBody` and the stage enum |
| wrong board string caused hours of 400s and a false "human must promote" diagnosis | 2026-08-08 01:50–01:52 |
| board does not self-advance on merge | repeated phantom-card cleanups, 2026-08-07 17:58 and 18:26 |
| in-flight 10 vs sandbox 32; live5m=5 vs live15m=19 | service environment; liveness probes, 2026-08-07 18:08 and 18:29 |
| dispatch before board cleanup produced six redundant agents | 2026-08-07 17:56–18:13 |
| `Number("only")` = NaN re-kicked the whole board twice | 2026-08-07 18:35 |
| setup command stale after rename; running agents unaffected | 2026-08-07 18:38 |
| layout-agnostic setup fix | 2026-08-08 01:54 |
| `sent` ≠ done; one item requeued 9× in 2.5 h; 11th and 12th kickoffs | keeper analysis, 2026-08-07 21:14 and 22:30 |
| gate order, fail-open pair, multi-board refusal | `scripts/factory_keeper/gates.py` |
| keeper fixed but never installed; symlink root bug | 2026-08-07 21:14 and 21:16 |
| deployed keeper refused 31 of 34 rows | dry run and live log, 21:16–21:17 |
| verdicts go to a log file, silent exit 0 is normal | keeper `main()` |
| OOM while systemd reports active; heap ceiling fix | service logs; unit environment |
| restart costs ~2.5 h of mid-turn work; sessions not resident after restart | 2026-08-07 14:31 crash and recovery |
| two upstream defects | identified during PR #225 review |
| one malformed part among ~6,700; blast radius one thread | 2026-08-07 22:30–22:38 |

# 05 — Test Strategy

**Premise:** a rule with no failing test is a wish. The prototype had excellent testing instincts — boundary pins, mutation tests, parity checks, and proof artifacts were all invented there and all earned their keep. It also had rules that were prose, suites that passed vacuously, and a green test run over a broken build. This document keeps the first list and closes the second.

**Companion documents:** the boundaries are defined in [01-ARCHITECTURE.md §5](01-ARCHITECTURE.md); the proof discipline is [ADR-0012](02-DECISIONS/0012-claims-needing-a-desktop-are-proved-by-artifact.md).

---

## 1. Six kinds of test, and what each is for

| Kind | Question it answers | Runs in CI |
|---|---|---|
| **Unit** | does this function do what it says | yes |
| **Boundary pin** | is this architectural rule still true | yes |
| **Mutation** | would breaking this guarantee actually turn a test red | yes, selectively |
| **Golden fixture** | did the wire contract change | yes |
| **Integration** | do two real components agree | yes |
| **Proof artifact** | is this true on a real desktop with a real person | **no** — release gate |

The prototype had all six. What it lacked was a written rule about which claim needs which kind, so the answer was decided per-PR by whoever was writing it.

---

## 2. Boundary pins

A boundary pin is a **source-level test**: it reads the source files of a package as text and asserts a structural property. It is not elegant. It is the only thing that reliably stops a rule from decaying, because it fails on the *shape* of the code rather than on its behaviour.

The pins are the twelve boundaries in [01-ARCHITECTURE.md §5](01-ARCHITECTURE.md): daemon-only accessibility imports, no audio in the hub, no credentials in clients, one microphone consumer per client, one transport implementation, the schema gate, generator determinism, no raw-input tools, no transcriber, no platform vocabulary in the schema, no effect enforced after the fact, and no non-permissive dependency.

Three of those are new and are the ones without prototype scar tissue behind them, so they need the most care in the writing:

- **B10 — no platform vocabulary in the schema.** Reads `protocol/schema.json` and asserts no identifier matches a list of platform and toolkit names. Rule 4 below applies: pin the differing *set*, so that adding a platform's word fails loudly rather than slipping in beside the others.
- **B11 — no effect enforced after the fact.** The only pin here that is about *timing* rather than presence. It reads the daemon's dispatch table and asserts that every operation of class `edit`, `activate`, `submit` or `destructive` is marked enforced-before-call. Enforcement on the *result* is permitted only for `observe`. The reasoning is not stylistic: once a result exists, the effect has happened, and filtering the response does not unsend the email. This pin is worth a mutation (§3) — flip one effect-class operation to result-time enforcement and confirm it goes red.
- **B12 — every dependency carries a permissive licence.** Reads every manifest in the tree against an allowlist of MIT, BSD, Apache-2.0 and ISC. Rule 3 below is the whole point of it: this is a manifest check by construction, because a licence problem is never visible in source. Two known holes to state rather than pretend away — a system library we require but do not ship is out of its reach and needs a recorded exemption with a reason, and an abandoned-but-permissive project passes cleanly, which is why adoption records a maintenance note as well as a licence.

### Four rules for writing one

These are all corrections to mistakes the prototype actually made.

**1. Assert the file list is non-empty.** A glob that matches nothing passes every assertion and reports success. The prototype discovered its single-audio-device rule had never covered the dashboard package — the rule was, in the words of the fixing PR, *"habit, not a rule."* Every pin begins by asserting it found files to check.

**2. Strip comments before grepping.** The comment explaining why the transcriber is gone contains the word `transformers`. A pin that greps raw text fails on its own documentation, and the fix people reach for is deleting the explanation.

**3. Check the manifest, not only the source.** The prototype deleted its transcriber — seven files, 80 MB — and `@huggingface/transformers` is *still* the widget's only runtime dependency, because the pin greps source files. Deleting code does not delete the dependency.

**4. Pin the differing set, not each difference.** The prototype's demo-mode test asserts that demo and resident window options differ in *exactly* a named list of keys. When a later change made `focusable` always true, the test failed with a diff of the set — which is what you want. A test asserting each option individually would have silently kept passing while the set changed underneath it.

---

## 3. Mutation testing

A passing test suite proves the tests pass. It does not prove they would fail if the guarantee broke. For load-bearing rules, that difference matters, and the prototype's practice here was genuinely good.

**The method, as practised:** take a guarantee, break it on purpose in the source, run the suite, and record how many tests go red. Then restore. The prototype's liveness work (PR #230) did this for six separate guarantees:

| Guarantee broken | Tests that went red |
|---|---|
| the ping call removed | 2 |
| the pong listener removed | 2 |
| the opening voice-state frame removed | 24 |
| pong no longer touches the session clock | 1 |
| ageing computed at publish instead of at read | 1 |
| sessions dropped from the status body | 3 |

**And the detail that makes it trustworthy: each mutation asserts that it applied before running the suite.** A patch that silently fails to apply produces a green run, which reads as "the guarantee is untested" but is actually "the experiment did not happen." The keeper's mutation suite does the same — it inverts each gate in turn and *requires* red.

### What gets a mutation test

Not everything. Mutation tests are expensive to write and to maintain. Apply them to:

- Every one of the nine boundaries.
- Every security-relevant refusal: scope enforcement, attestation, deny-by-default visibility, token TTL.
- Every gate in a decision function whose job is to refuse — the keeper's `should_requeue` is the model.
- The wake gate's open/closed decision.

Not to ordinary business logic. If breaking it obviously breaks a hundred tests, the mutation test tells you nothing you did not know.

---

## 4. Golden fixtures and the protocol

The wire contract is checked three ways, and all three run in CI:

1. **Golden fixtures.** Frozen request/response pairs in `protocol/golden/`. These are what a reviewer actually reads when the protocol changes, because they show behaviour rather than schema syntax.
2. **Generator determinism.** Regenerate every binding from `schema.json` on a clean checkout; fail on any diff. This is what makes it safe not to commit generated code ([ADR-0009](02-DECISIONS/0009-generated-code-is-build-output.md)).
3. **The freeze gate.** Any change to `schema.json` fails unless it carries an ADR, a version bump, and updated fixtures ([ADR-0002](02-DECISIONS/0002-schema-freeze-is-a-ci-job.md)).

**Plus digest agreement:** the daemon computes a schema digest and keys its socket on it; the transport package embeds one. CI asserts they are the same value. The prototype had this mechanism and one of its two daemon clients had quietly skipped the check — which is precisely the kind of thing an assertion in CI catches and a code review does not.

**Parity tests get a special mention, because we are deliberately removing the need for them.** The prototype maintained byte-for-byte parity tests between three copies of the same modules, and they worked — one caught a hand-edit to a vendored copy during live debugging. Under [ADR-0003](02-DECISIONS/0003-one-shared-transport-package.md) there is only one copy, so there is nothing to keep in parity. **If a parity test ever becomes necessary again, that is a signal that a duplication has been introduced**, and the right response is to remove the duplication rather than to write the test.

---

## 5. Test lanes, and the abort problem

The daemon's tests have two lanes, and this is not a convenience:

| Lane | Requires | Runs |
|---|---|---|
| `--no-live` | nothing | CI, every push |
| live | a display and an accessibility bus | manually, on hardware |

**The reason is severe:** AT-SPI2 can **abort the interpreter** when the accessibility bus is absent. Not raise an exception — abort. A live-only test that runs on a headless CI machine does not fail, it kills the runner, and the failure looks like infrastructure flakiness. Every live-requiring test must be marked, and the default lane must be the safe one.

The same split applies upward. Anything needing a real desktop is a proof artifact (§6), not a test.

---

## 6. Proof artifacts

Full rationale in [ADR-0012](02-DECISIONS/0012-claims-needing-a-desktop-are-proved-by-artifact.md). The operational summary:

- A proof is a script in `tools/` that runs against a live desktop and writes markdown into `docs/proofs/`.
- **A proof that cannot prove writes nothing.** Distinct exit codes for distinct failures; no partial artifact; no estimated numbers.
- **Results are read out of band.** From the desktop's own state, the audit trail, or a streaming log — never from the agent's report of its own success.
- **Refuse the comparison you cannot defend.** The prototype's token-cost proof declines to produce a "roughly N times cheaper" figure, and a test greps the output to make sure that phrasing cannot appear.
- **The artifact states its own limits:** what was exercised, what was not, on what hardware, on what date.
- **A dependency bump invalidates the proofs that depend on it.** `docs/proofs/README.md` names which.

**Proofs are never a CI gate.** They are a release gate, listed per milestone in [07-ROADMAP.md](07-ROADMAP.md).

---

## 7. What CI runs, in order

```
1. protocol: regenerate → diff → fail on drift
2. protocol: freeze gate (ADR + version + fixtures, if schema.json changed)
3. protocol: digest agreement (daemon ↔ transport)
4. boundaries: all nine pins, every package
5. unit + integration suites, per package
6. typecheck, per package, --noEmit, with the package's own tsc
7. build, per package that ships a bundle
8. mutation checks, on the selected set (§3)
9. integration dry-run against the destination monorepo (04-INTEGRATION-PLAN §7)
```

**Three details that are not obvious and each cost the prototype something:**

**Step 6 uses the package's own TypeScript.** A floating compiler resolves differently than the one the package declares, and a typecheck that passes with the wrong compiler is not a typecheck.

**Step 7 is separate from step 5 on purpose.** The prototype shipped a package where tests and typecheck were green while the production build failed, because the bundler needed alias configuration the test runner never read. A green suite is not a green build.

**A green run must be verified, not inferred from a lack of shouting.** The prototype had a gate that printed `[ELIFECYCLE] Test failed` and exited 0. Read the counts, not the vibe.

---

## 8. Conventions

**Test names are sentences about behaviour.** The prototype's best test names read like claims — *"never runs off the window, however the face was dragged"*, *"the wake decision is a shape, and nothing here writes down what was said"*. When such a test fails, the failure message is the specification. Keep this.

**Dashboard tests run in Node with no DOM library.** Logic is extracted into pure functions and tested directly; rendering is checked with static markup rendering. This is a constraint that improves the code: the prototype's enrolment walkthrough became a pure state machine over a phase value rather than sequencing buried in component effects, and *that* was testable in a way the effects never were.

**Red before green on a regression.** A fix for a reported bug ships with a test that fails without the fix. Verify it fails — an untriggered regression test is an assertion about nothing.

**Say what you did not test.** The prototype's PR bodies did this well: *live conversation not exercised — needs a real desktop, a mic, and a person*, followed by the manual steps a human should perform. An honest gap is information; an unstated gap is a claim.

---

## 9. What this strategy deliberately does not do

- **No coverage percentage target.** The prototype had roughly 1,100 Python tests and 786 hub tests and still shipped a keeper that had never been deployed and a setup command that could not run. Coverage measures lines executed, not rules enforced.
- **No end-to-end browser automation of the widget.** The face is verified by live proof on real hardware, because the things that broke about it — window-manager management, stacking, multi-monitor drag — are properties of a real X11 session and cannot be faked.
- **No mocking of the accessibility layer in unit tests beyond the transport seam.** A mocked AT-SPI2 tests our mock's understanding of AT-SPI2, which is exactly the understanding that has been wrong before.

---

## Receipts

| Claim | Source |
|---|---|
| boundary suite passed vacuously; "habit, not a rule"; non-empty assertion; comment-stripping | PR #226 (closes issue #222) |
| transcriber deleted, dependency remains | `clients/widget/package.json` at pivot; pin greps source only |
| demo-mode diff-pin caught `focusable` leaving the differing set | PR #228 merge, `boundaries.test.ts:427-458` |
| six mutations with red-count per guarantee | PR #230 (closes issue #206) |
| each mutation asserts it applied first | PR #230 |
| keeper mutation suite inverts each gate and requires red | `comcon/tests/test_factory_keeper_mutation.py` |
| gate ordering: cheap structural first, activity check last, two gates fail open | `scripts/factory_keeper/gates.py` |
| one of two daemon clients skipped the digest check | PR #227 |
| parity test caught a hand-edited vendored copy | `face-parity.test.ts:53`, 2026-08-08 02:06 |
| AT-SPI2 can abort the interpreter without a bus; `--no-live` lane | prototype `docs/08-prototype-notes.md` |
| token-cost proof: out-of-band read, refused comparison, greps for forbidden phrasing, no artifact on failure | PR #218 (closes issue #18) |
| proofs invalidated by dependency bump | `docs/proofs/README.md` |
| green tests + green typecheck, broken build | commit `0eade11` |
| gate printed a failure line and exited 0 | widget gate behaviour, observed repeatedly |
| dashboard tests: node env, no DOM library, pure state machine | PR #226, `dashboard/src/lib/wake-walkthrough.ts` |
| suite sizes at pivot: 1,126 Python / 786 hub / 164 widget | gate runs, 2026-08-07 to 2026-08-08 |
| PR bodies stated untested gaps and manual steps | PR #231 |

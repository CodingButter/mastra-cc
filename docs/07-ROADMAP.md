# 07 — Roadmap

**Structure:** milestones, in order, each with an **exit gate that can fail**. A milestone is not complete because the work feels done; it is complete because a named command exits zero or a named artifact exists on disk.

**Why gates:** the prototype closed issues on the strength of implementations that looked right, then discovered a keeper that had never been deployed and a setup command that could not run. A gate that cannot fail is a status update wearing a costume.

**Sequencing principle:** one author until the north star sentence works, then parallelise. → [ADR-0015](02-DECISIONS/0015-one-vertical-slice-before-parallel-agents.md)

---

## M0 — Documents

**Goal:** a fresh session can read this directory cold and build the right thing.

**Deliverables:** the nine documents in `docs/`, the ADR series in `docs/02-DECISIONS/`, `README.md`, and `CONTRIBUTING.md`.

**Exit gate:**
- [x] Every internal link resolves — the docs gate exits 0 over 27 files, *the count at M0 close on 2026-08-08*. The gate has since been ported from Python to Node (`scripts/check-docs.mjs`) and the repository has grown; this line records what was checked then, and is not re-run to a current number.
- [x] Every document's Receipts table has at least one entry per non-obvious claim.
- [x] Jamie has reacted to the three open decisions — all three taken on the recommendation, 2026-08-08. See §"Decisions taken" below.

**Status:** complete, 2026-08-08. The verify pass caught three of its own factual errors before it closed (the schema-freeze count, the number of operation classes, and two churn figures), which is the only reason to trust the rest — see [05-TEST-STRATEGY.md](05-TEST-STRATEGY.md) on gates being proved by failing.

**M0.5 is unblocked.**

---

## M0.5 — Research ✅ closed 2026-08-09

**Goal:** answer, or knowingly defer, every question whose answer would change what M1 builds — before M1 builds it.

**Outcome.** All twenty questions closed, plus six added as Group G — the improvement thesis, which existed only in conversation. Sixteen measurement artifacts in [docs/proofs/](proofs/). Six decision records forced by findings ([ADR-0027](02-DECISIONS/0027-the-assistant-opens-the-application-itself.md) – [ADR-0032](02-DECISIONS/0032-the-page-layer-is-an-instrument-not-a-gate.md)); six earlier records superseded. All spike code deleted, as required.

**The four findings that changed what M1 builds:**

1. **An entire subsystem is gone.** Readability is decided at process start and nothing can change it afterwards, so the assistant opens the application itself and rewrites nothing on the user's system. [ADR-0020](02-DECISIONS/0020-granting-an-application-is-a-transaction-with-a-rollback.md) is retired outright.
2. **The daemon is one Node process.** Linux accessibility is plain D-Bus underneath; Node matched Python on read, write and events. No Python, no sidecar, no cross-language seam — and [04-INTEGRATION-PLAN.md §4](04-INTEGRATION-PLAN.md)'s hardest obstacle disappears with it.
3. **A fourth adapter exists and covers the majority case.** The browser protocol reaches Chrome *and* every Electron application from one implementation — **2.8× faster** than the platform route on the same browser at the same moment (44ms against 16ms), and it needs no accessibility flag at all. The protocol is identical across operating systems, so this adapter is *expected* to need no per-platform work; **that expectation is unmeasured — every measurement in [docs/proofs/](proofs/) was taken on Linux.**
4. **The improvement thesis survives its first measurement, unevenly.** Steps to completion: 9.0 cold against 6.0 warm with zero spread, recovering to baseline one run after the interface changed. Tokens: **not established at this sample size** — the spread is larger than the effect, and the mean flatters.

**What it deliberately left open** is listed in [09-QUESTIONS.md §6](09-QUESTIONS.md), so M1 starts with an accurate picture of its own ignorance: live Gmail (needs credentials that are not the agent's to hold), Qt's enabling knob, Windows and macOS from Node (read, never run), and a wake model whose licence permits commercial use.

**Why this exists.** It was inserted 2026-08-08, after M0 closed and before any code. Several decisions taken that day rest on beliefs that have not been probed, and two of them could *delete* work rather than add it. Building first and discovering second is precisely how the prototype rewrote one module thirty-five times.

[ADR-0010](02-DECISIONS/0010-daemon-is-python-single-threaded-default-glib-context.md) rule 5 already says capability is probed and never inferred; this milestone applied that rule to the plan itself — and then, fittingly, retired ADR-0010's own language choice on the strength of a measurement.

**Deliverables:** the twenty questions in [09-QUESTIONS.md](09-QUESTIONS.md), each closed as *answered* (with a receipt) or *bookmarked* (with the specific source where the answer lives). Findings written into the documents where the work will happen — an amended ADR, a new ADR, or a correction — never left in a spike's output.

**This milestone writes code, and none of it survives.** Spikes are throwaway by construction. If a spike's code starts to look reusable, that is the signal that we have stopped researching and started building.

**Exit gate:**
- [x] Every question in [09-QUESTIONS.md](09-QUESTIONS.md) is closed, with its own stated requirement met.
- [x] `scripts/check-docs.mjs` exits 0.
- [x] Every decision a finding invalidated has been **superseded in writing**, not edited in place.
- [x] A cold reader — a person, or a session with no memory of these conversations — can read `docs/` and begin M1 without asking a question. **Tested, not assumed:** [how this milestone checked itself](proofs/how-this-milestone-checked-itself.md) records the mechanism, what the reader answered, and the defect it found that a review had missed.

**Discipline clause:** no new ADR during this milestone unless a finding forces one. Wanting to write one because of a good idea is the signal that we have drifted from converging back to generating.

**The two that could remove work went first, and both did.** **Q01** deleted [ADR-0020](02-DECISIONS/0020-granting-an-application-is-a-transaction-with-a-rollback.md) entirely; **Q07/Q08** deleted the Python boundary and most of [04-INTEGRATION-PLAN.md §4](04-INTEGRATION-PLAN.md). A milestone whose two highest-leverage questions both subtracted is the argument for measuring before building, made once in practice rather than repeatedly in prose.

---

## M1 — Skeleton

**Goal:** the repository shape, the toolchain, and the gates — with no features at all.

**Deliverables:**
- The layout in [01-ARCHITECTURE.md §3](01-ARCHITECTURE.md).
- `infra/apply.sh` and the unit files it installs.
- `protocol/schema.json` at v1.0 with the generator and golden fixtures.
- CI running all nine steps in [05-TEST-STRATEGY.md §7](05-TEST-STRATEGY.md), including the freeze gate and the integration dry run — passing on a nearly-empty tree.
- Catalog-aligned dependency versions per [04-INTEGRATION-PLAN.md §3](04-INTEGRATION-PLAN.md).

**Exit gate:**
- [x] `turbo run build lint typecheck test` exits 0. (Ticked on `feat/m1-skeleton`: 14 of 14 tasks, 81 tests passing plus 5 live-lane skips, witnessed by CI on every phase commit.)
- [x] `tools/dry-run-integration.sh` exits 0 against a pristine monorepo checkout, **including the catalog-divergence check**. (Ticked: `catalog-check: 4 pin(s) compared, aligned with the destination`, run in CI step 9 on every commit.)
- [x] The freeze gate **fails** on a deliberate one-character edit to `schema.json` with no ADR — verified by doing it and watching it go red. (Ticked in both directions, in CI: break commits `c4ad135` and `4755573` went red at steps 1 and 2 of run 31336286331 and run 31336328347, the revert went green in run 31336346452. Transcripts: the freeze red/green pair recorded in commit `318e140`.)
- [x] The generator determinism check **fails** on a deliberate hand-edit to a generated file — same method. (Ticked: `tools/determinism.mjs` regenerates into a temporary directory and diffs, because regenerating in place silently repairs the tampering; the hand-edit case is pinned red by the `freeze-gate-golden-staleness-check-removed` and determinism mutations in `tools/mutations.json`, all of which draw at least one red test.)
- [x] `infra/apply.sh` runs clean on a fresh machine and the installed keeper-style script executes from its installed path. (Ticked: fresh-prefix run under `MASTRA_CC_PREFIX` applied 2 changes, exit 0, and `<prefix>/.local/libexec/mastra-cc/health.sh` executed from the installed path reporting unit, socket and accessibility-bus state.)
- [x] **The debt M0.5 recorded is paid:** concurrent accessibility access is measured on the Node route, with every connection established and read sequentially first, so the result separates *concurrent setup aborts* from *concurrent use is unsafe* ([is the accessibility binding thread-safe](proofs/is-the-accessibility-binding-thread-safe.md), [ADR-0030](02-DECISIONS/0030-the-daemon-is-one-node-process.md) clause 3). Either answer is acceptable; leaving it unmeasured is not, because the serialisation rule is currently kept on judgement alone. (Ticked: [is concurrent accessibility safe on the Node route](proofs/is-concurrent-accessibility-safe-on-the-node-route.md) — 27 runs, both orderings at 2/4/8 connections, three repetitions each, every run exit 0. Neither failure mode was observed; the daemon keeps serialising for audit attributability, a reason the measurement does not touch.)

**Note on the third and fourth items:** a gate is not proven by passing. It is proven by failing when it should. Do both, record both.

### M1's first commit, concretely

Written for a reader with no memory of the conversations that produced this repository. A gate over an empty tree passes vacuously — [05-TEST-STRATEGY.md §3](05-TEST-STRATEGY.md) — so the first commit is a **thin vertical slice with a real spine**, not scaffolding.

**Build, in this order:**

1. `protocol/schema.json` with exactly **two** methods — `queryElements` and `attestElement`. Two, because one cannot exercise the generator's handling of shared types and twenty is a week of work before anything is proven.
2. `protocol/generate.mjs`, emitting TypeScript bindings from that schema, plus golden fixtures. Generated code is build output, never source — [ADR-0009](02-DECISIONS/0009-generated-code-is-build-output.md).
3. `packages/transport/` — the one daemon client. Every other package reaches the daemon through it; a second, drifted client is what [ADR-0003](02-DECISIONS/0003-one-shared-transport-package.md) exists to prevent.
4. `daemon/` in **Node** ([ADR-0030](02-DECISIONS/0030-the-daemon-is-one-node-process.md)), answering `queryElements` against one backend and one element. Everything touching the accessibility layer is serialised, by design rather than by measurement: the abort measured in M0.5 was `libatspi`'s, and this daemon does not load it ([ADR-0030](02-DECISIONS/0030-the-daemon-is-one-node-process.md) clause 3). Serialising is what makes an audit record attributable, and it is what the owed measurement below tests against.
5. `apps/hub/` calling that method through the transport and printing the result.

**The first gate it must make fail** — and this is the part that matters, because it is the failure the prototype's freeze gate never produced:

> Edit one character in `protocol/schema.json` without an accompanying ADR, run CI, and **watch the freeze gate go red**. Then revert and watch it go green.

The prototype's freeze was prose. The schema changed 23 times after being frozen and nothing ever failed — [ADR-0002](02-DECISIONS/0002-schema-freeze-is-a-ci-job.md). Both directions of that gate get recorded in the commit message, because a gate that has only ever passed is indistinguishable from a gate that is not wired up.

**Two backends exist and M1 builds neither fully.** The browser-protocol adapter covers Chrome and every Electron application from one implementation; the Linux accessibility adapter covers native toolkits. M1 wires *one* of them to *one* method. Choosing which is an M1 decision, not a prerequisite — the protocol vocabulary is neutral by [ADR-0018](02-DECISIONS/0018-the-protocol-speaks-a-neutral-element-vocabulary.md), so the caller cannot tell which answered.

**Resolved during M1 (2026-08-09):** the user chose the **accessibility route** — "there are less questions about chromium. so lets focus early on the accessibility route." The browser protocol's open questions were fewer and cheaper to answer later; the accessibility route carried the unknowns worth burning down first (whether Node could read the bus without a native addon, whether real trees were walkable, whether concurrency aborted). M1 built the Linux AT-SPI backend; the browser-protocol adapter remains the next backend, behind the same interface and the same conformance suite.

**What M1 must not do:** no wake detection, no voice, no dashboard features, no consent UI, no second protocol method added for completeness. Those are M2 onward, and the exit gate above is the whole of the work.

---

## M2 — The daemon reads

**Goal:** the accessibility layer, under scope, with attribution.

**Deliverables:**
- Daemon with transport, dispatch, scope enforcement, and **two** backends as separate modules: the browser protocol and the Linux accessibility layer. M0.5 established the browser route is the majority case on the platform it was measured on — it covers Chrome and every Electron application — so building it second would be building the harder one first.
- The launch mechanism from [ADR-0027](02-DECISIONS/0027-the-assistant-opens-the-application-itself.md), including the ownership table from [ADR-0029](02-DECISIONS/0029-the-daemon-knows-what-it-launched.md). Without it, applications are unreadable and nothing else in this milestone can be demonstrated.
- `observe` scope end to end; `edit`, `activate`, `submit` defined and refused.
- The change stream — the desktop talks first. Both routes have a push channel; the browser one was measured at 253ms from cause to observation.
- Effect attribution, with the glossary's locked triple: `self` (with a cause id), `external`, `unattributed`. Unmatched effects are **labelled, never flagged** — [ADR-0032](02-DECISIONS/0032-the-page-layer-is-an-instrument-not-a-gate.md).
- Deny-by-default application visibility.
- Both test lanes.

**Exit gate:**
- [x] `--no-live` suite green in CI. Evidence: [CI run 31656176860](https://github.com/CodingButter/mastra-cc/actions/runs/31656176860) (master, 2026-08-13, success).
- [x] Live suite green on real hardware, with the machine and session type recorded in the receipt. Evidence: [the live suite on real hardware](proofs/the-live-suite-on-real-hardware.md) — 37/37 both lanes, minibeast, Wayland.
- [x] Boundary pin B1 passes and **fails** when an accessibility import is added to a non-daemon package. Evidence: [the pin fails when provoked](proofs/the-live-suite-on-real-hardware.md#the-pin-fails-when-provoked) — red names the file and binding, green counts 23 files scanned.
- [x] Proof artifact: `an-unpermitted-application-is-invisible.md`, produced on real hardware. Evidence: [an unpermitted application is invisible](proofs/an-unpermitted-application-is-invisible.md) — both routes, refusals byte-identical on the full constant.
- [x] A refusal for an out-of-scope operation names the check that produced it. Evidence: the refusal constants open with `refused by the effect-class gate:` ([daemon/src/server.ts](../daemon/src/server.ts)) and [the tests](../daemon/src/__tests__/refuses-beyond-observe.test.ts) assert the gate is named in every before-call refusal.
- [x] **The two questions M0.5 could not close, closed here:** live Gmail end to end, against a profile the operator signed into by hand; and Qt's per-process enabling knob, on a machine with Qt6 installed. Evidence: Q03 and Q05 closes in [09-QUESTIONS.md §6](09-QUESTIONS.md), receipts in [real Gmail through the daemon](proofs/real-gmail-through-the-daemon.md) and [the Qt6 accessibility knob, measured](proofs/the-qt6-accessibility-knob-measured.md).

**A visibility verdict carries its route — implemented in M2.5.** M0.5 asked both routes to decide whether a person can actually see an element, judged against layout ground truth: the browser route scored 10 of 10, the platform route 6 of 10 — it cannot detect a fully transparent element, and its hit test returns *self* for an element covered by an opaque panel. **Bounds alone is a liar**: a covered button has a perfect rectangle. A bare boolean hides which instrument produced it, so every element answer now stamps `diagnostic["mastra-cc/visibility-route"]` with the instrument that produced it — [ADR-0040](02-DECISIONS/0040-a-visibility-verdict-carries-its-route.md). See [what hidden actually means](proofs/what-hidden-actually-means.md).

---

## M2.6 — The daemon acts ✅ closed 2026-08-19

**Goal:** every desktop interaction a person performs, available and enforced at the daemon — decided, frozen into the schema, implemented on both routes, and proven on real hardware.

> **Why this milestone exists, and why it is numbered 2.6.** M2's contract was deliberately *"`observe` scope end to end; `edit`, `activate`, `submit` defined and refused"*, and it delivered exactly that. But no milestone after it ever implemented those three verbs: M3 is the hub, M4 the face, M5 wake, and M6 casually assumes *"one semantic action against a real mail client"* works. **The plan froze three verbs and then, four milestones later, assumed they had been thawed.** That is a hole, not a sequencing preference. It is numbered 2.6 rather than inserted as a new M3 because 49 references to M3–M8 exist across this documentation tree, and a renumbering reshape is the exact churn that cost the prototype an outage ([03-LESSONS.md](03-LESSONS.md) Family 5, PR #227 — 179 files, 135 renames). The number is cheap; the reshape is not.

**The ordering ruling behind it** ([ADR-0043](02-DECISIONS/0043-an-element-publishes-its-own-actions.md) clause 6): layers are finished before layers are built on them. A hub that mints a tool surface over an incomplete verb set is configuring a capability list that does not exist. The daemon is the foundation; it gets completed first.

**Deliverables:**
- **The capability set, decided.** Not "the verbs we thought of" — the set is derived from what elements actually publish, per [ADR-0043](02-DECISIONS/0043-an-element-publishes-its-own-actions.md). Deciding the set is the milestone's first task and its first artifact.
- **Actions read from the element, never from a role table.** `actionsForRole` deleted from both backends; the closed four-value action enum replaced by an open vocabulary carrying unmapped natives under their own names.
- **The three action states** — available / disabled-by-configuration / not-exposed — distinguishable on the wire and never collapsed.
- **`edit`, `activate` and `submit` implemented**, on both routes, with attestation before `submit` as [ADR-0008](02-DECISIONS/0008-scopes-operation-classes-and-honest-refusals.md) rule 2 requires. The refusal-only stubs from [ADR-0037](02-DECISIONS/0037-the-other-three-classes-are-on-the-wire-before-they-are-possible.md) are replaced by the operations they were placeholders for.
- **Window management**, to the extent the accessibility layer exposes it — and an honest, recorded boundary where it does not. Compositor-level access stays deferred (§8); what cannot be done through the tree is named as a limitation, not quietly omitted.
- **The application listing** from [ADR-0042](02-DECISIONS/0042-existence-is-readable-content-is-not.md): installed applications, their permitted capabilities, and the setting behind each refusal.
- **Focus preservation on launch** ([ADR-0044](02-DECISIONS/0044-the-assistant-does-not-take-the-desk.md)), with the Wayland restoration route measured rather than assumed.
- **User-facing capability configuration** — per application and globally, with defaults that are ours and policy that is the user's.

**Exit gate:**
- [x] An element's published actions come from the platform. Evidence: `actionsForRole` is gone from both backends, and a source-level assertion pins it out (`daemon/src/backends/cdp/__tests__/actions.test.ts`); the mutations `the-reader-asks-every-element-for-verbs-it-never-published` and `the-browser-route-advertises-a-verb-on-a-disabled-control` (`tools/mutations.json`) redden tests when the reading is broken; both replay worlds publish a name outside the four invented words, asserted at `daemon/src/__tests__/backend-conformance.test.ts` (desktop `click`, browser `collapse`); and the live leg read `click` off real window-chrome buttons that the deleted table would have called `press`.
- [x] The three action states are distinguishable, and collapsing two of them reddens a test. Evidence: `packages/transport/src/__tests__/open-actions.test.ts` — the three states each carry a different obligation, and a configuration-withheld action naming no setting, a not-exposed action naming one, and an available action naming one are each refused.
- [x] Each of `edit`, `activate` and `submit` performs a real change on real hardware, observed and attributed — and each is refused, before the call, when configuration disables it (B11). Evidence for *performs a real change, observed*: the live proof on a Wayland session typed into a real field and read the text back from the application over a connection the daemon never touched, flipped a checkbox and verified the *state in the tree* rather than the return value, and committed a dialog that printed its own committed form on the way out (`.mastracode/plans/m2-6-the-daemon-acts.proof/with.txt`, `demo.sh` legs `e`/`a`/`s`; the same script against the previous daemon fails at the first leg — `without.txt`). Verified-by-reading-back is pinned rather than incidental: `daemon/src/__tests__/verified-by-reading-back.test.ts`, and the mutation `the-verdict-forgets-its-instrument` reddens tests when it is broken. Evidence for *attributed*: `daemon/src/__tests__/attribution.test.ts` — a change inside the application a verb is operating on is stamped `self` with the cause id, and the same change with nothing in flight is stamped `external`. Evidence for *refused before the call*: `daemon/src/__tests__/launch-authority.test.ts` covers all three verbs, asserting the backend is never reached; B11 (`tools/pins/b11.mjs`) witnesses every non-observe dispatch entry as `enforcement: "before-call"`; leg `r` of the live proof shows the field byte-identical before and after an ungranted session's three refused calls. **Evidence for *refused when configuration disables it*, the half that was outstanding until segment 3:** the user's own capability file (`daemon/src/capabilities.ts`, `--capabilities <file>`) withholds a capability per application or globally, and the refusal **names the setting that would grant it** rather than stating a bare denial — `withheldBy` returns the setting name, never a boolean, and the refusal says which setting withholds it and that changing it is what would allow it (`daemon/src/__tests__/capability-configuration.test.ts`, 19 tests; mutations `the-configuration-is-read-and-never-enforced` and `a-withheld-capability-is-reported-as-available`). Authority is asked first and configuration second ([ADR-0019](02-DECISIONS/0019-capability-is-not-authority.md)), both before the call. A malformed configuration file **fails startup loudly** rather than becoming a silent "everything is allowed", and there is deliberately **no switch that turns the enforcing off** — a permission system with a disable switch is a permission system that lies.
- [x] `submit` refuses with `ATTESTATION_FAILED` when the daemon cannot describe what it is about to commit. Evidence: `commitDescription` (`daemon/src/backend.ts`) is asked *before* the commit on both routes and throws `AttestationFailedError` when the element names nothing, publishes no verb, or publishes several — the refusal states the daemon's own inability and never judges the caller's sentence, which `daemon/src/__tests__/attestation.test.ts` pins by giving a careful attestation and an empty one and asserting they receive byte-identical answers. Fired on real elements in the live proof, not only in tests: the same session, the same attestation, refused on a window that publishes no verb and committed on a button that publishes one (`.mastracode/plans/m2-6-the-daemon-acts.proof/with.txt`, leg `s`).
- [x] The application listing agrees with the dispatch table: a capability reported *refused* is refused in fact, and a capability reported *available* is not refused. A test fails if the listing and the enforcement disagree. Evidence: the listing and the gate are **the same function asked at two different moments** — `capabilityStateFor` (`daemon/src/server.ts`) answers `listApplications` and drives the before-call refusal, because two hand-maintained lists that happen to match today are a divergence waiting to ship. The agreement test walks **every application × every capability** and asserts the wire answer against what the gate actually does (`daemon/src/__tests__/installed-inventory.test.ts`); the mutations `a-withheld-capability-is-reported-as-available` and `the-listing-answers-from-its-own-table-not-the-gate` (`tools/mutations.json`) redden tests when the two are allowed to drift apart. Witnessed live in step 2 of [every action the desktop offers](proofs/every-action-the-desktop-offers.md): an unpermitted session reads the entry, sees each capability's state with the setting behind it named, and is refused in fact on all of them.
- [x] Launching an application does not move focus, verified on real hardware while a text field holds it; a launch that cannot restore focus says so rather than reporting a clean launch. **Met as *detect and disclose*, not as *restore*** — see the named limitation below. Evidence: `.proof/focus.sh` measured a `yad` text field holding the keyboard, launched `qt6ct` through the daemon, and read focus back three times from the tree via an independent witness decoding the platform's own constants (`.proof/focus-witness.mjs`); the daemon's answer carried `mastra-cc/focus-preservation` stating the keyboard had moved, rather than reporting a clean launch. The identical script against the previous daemon reports a clean launch while the keyboard demonstrably moves. Pinned offline by `daemon/src/__tests__/focus-preservation.test.ts` (8 tests) and `daemon/src/backends/__tests__/focus-instrument.test.ts` (5 tests), with the mutations `a-launch-takes-the-focus-and-never-gives-it-back`, `the-restore-is-believed-instead-of-read-back` and `focus-is-read-from-the-per-application-bit-alone`. **The limitation, named rather than omitted ([ADR-0044](02-DECISIONS/0044-the-assistant-does-not-take-the-desk.md) clause 4):** on this Wayland session `Component.GrabFocus` returns `true` and moves nothing — measured on 6 of 20 controls, the same shape of lie as `SetPosition`. Restoring the keyboard requires the compositor, which stays deferred (§8). X11 is unverified.
- [x] Proof artifact: `every-action-the-desktop-offers.md`, produced on real hardware, naming the applications exercised and the session type. Evidence: [proofs/every-action-the-desktop-offers.md](proofs/every-action-the-desktop-offers.md) — minibeast, Ubuntu 24.04, Wayland, GNOME; `yad` and `qt6ct` on the accessibility bus, headless Chrome 151 on the browser protocol. It records the two defects these legs found in this milestone's own work *after* the offline suite was fully green.
- [x] Both lanes green; the offline lane replays recorded elements carrying real action lists, not fixtures we authored. Evidence: both live lanes 55 passed / **0 skipped** on real hardware — the browser lane against headless Chrome with its own profile and page server (`infra/cdp-live.sh`), the accessibility-bus lane under `MASTRA_CC_LIVE=1` (`.proof/live-suite.sh`, transcript sanitised). The offline lane replays captured tapes and never hand-authored ones: `loadTape` refuses a fixture that was written by hand rather than captured, and both replay flavours publish action names read off a real tree (`daemon/src/__tests__/backend-conformance.test.ts`). Tape drift is reported rather than silently absorbed — see §4 of the proof artifact.

---

## M2.7 — The daemon is finished

**Goal:** every method the frozen schema declares is served, every effect is verified by comparing what was observed against what was intended, an independent client can reach the whole API over the wire, and the tooling that scores all of it survives being interrupted and fails loudly when broken.

> **Why this milestone exists.** M2.6 closed on the strength of a work list derived from the issue tracker, and the largest hole in the daemon had no issue filed against it: four of the thirteen wire methods answer with a constant refusal while all three backends implement them. [ADR-0047](02-DECISIONS/0047-the-wire-carries-words-we-did-not-invent.md) already ruled on this shape — *a method that answers only with a refusal is a promise, and a promise is not a feature* — and the promise outlived the milestone that made it. The rest of the milestone follows from the same question asked of every other claim the daemon makes: **is it verified, or merely reported?** An effect helper that re-reads an element and hands it back without comparing it to what was intended answers a caller honestly about a write that may never have happened. This milestone is the audit of the daemon's own assertions, and its exit gate was written before any of its code, because M2.6 merged its final segment on the author's own audit and that is the failure mode being corrected.

**The ordering ruling behind it** ([ADR-0043](02-DECISIONS/0043-an-element-publishes-its-own-actions.md) clause 6, restated): the daemon is completed before the hub is built on it. No hub, agent, or client work belongs in this milestone.

**Deliverables:**
- **The four unrouted methods routed** — `setElementValue`, `setElementText`, `setElementCaret`, `revealElement` reach the backend operations that already implement them, replacing the constant refusals in the dispatch table.
- **Effects verified by comparison, not by re-reading.** Every effect operation compares what the desktop shows afterwards against what was asked for, on both routes, with the two design exemptions (`grabFocus`, `submitElement`) stated rather than silently inherited.
- **The transport binds every method the daemon serves** — the client package reaches all thirteen, not five.
- **Tooling that guards itself.** The mutation runner restores the file it mutated when interrupted, fails loudly when it cannot run the tests, and every entry deletes exactly the line it names.
- **CI witnesses the live lane**, or records why it cannot with a release-gate transcript that does.
- **The deferred desktop truths, measured.** Whether the keyboard can be restored after a launch, and what Gmail's inbox rows are called — each answered on real hardware and either fixed or named as a limitation in an ADR.
- **The schema's prose agrees with the daemon's behaviour** — the method descriptions that describe routed methods as permanently refused are corrected under a version bump.

**Exit gate:**
- [x] No wire method answers with a constant. Checkable: `grep -n 'handler: async () =>' daemon/src/server.ts` returns nothing, the scope-refusal constants are no longer any method's unconditional answer - each now fires only through `performEffect`'s scope gate, enforced before the call - and `node tools/pins/run.mjs` reports thirteen dispatch entries with every non-observe entry enforced before the call. (Ticked 2026-08-20: grep empty, pin-b11 "13 dispatch entr(ies), every non-observe entry (8) enforced before the call"; PR #27.)
- [x] Every effect operation compares observed against intended, and the comparison is guarded. Checkable: each operation named in the milestone's read-back work has a `tools/mutations.json` entry that deletes its comparison, and `node tools/mutations.mjs` reports none survived. The two design exemptions are named in code with the reason, not omitted. (Ticked 2026-08-20: `tools/mutations.json` entries per comparison, 57-entry run at the final tree reporting "mutations: ok - 57 mutation(s), none survived"; exemptions `grabFocus` and `submitElement` named in code; PR #27.)
- [x] An independent client reaches all thirteen methods. Checkable: `packages/transport/src/index.ts` exposes a binding per method, and a test drives each one over a real socket against a real daemon. (Ticked 2026-08-20: `packages/transport/src/__tests__/every-method-is-reachable.test.ts`; PR #27.)
- [x] The mutation runner survives interruption and fails loudly. Checkable: a test sends the runner a signal mid-mutation and asserts the file on disk is byte-identical to the original; a test makes the test command unrunnable and asserts a non-zero exit with a message naming the runner, not a survival count. (Ticked 2026-08-20: `tools/__tests__/mutations-runner.test.mjs`, signal delivered to the process group with a marker-file handshake; PR #28.)
- [x] Every mutation entry deletes exactly the line it names. Checkable: the runner refuses an ambiguous find string (more than one occurrence) and a stale one (zero occurrences) with distinct non-zero exits before mutating anything, the refusal is guarded by a test, and a full run hits neither exit. (Ticked 2026-08-20: `tools/mutations.mjs` refuses ambiguous and stale find strings with distinct exits, guarded by `tools/__tests__/mutations-runner.test.mjs`; full run on the final tree hit no such exit; PR #28.)
- [x] No offline test can start a browser on the operator's profile. Checkable: the offline suite carries no path pairing the real launch catalog with a name reaching `spawn`, asserted by a test rather than by inspection. (Ticked 2026-08-20: `daemon/src/__tests__/support/defanged-catalog.ts` at every offline `catalog:` site, asserted by test; PR #28.)
- [x] CI witnesses the live accessibility lane, or a release-gate transcript records the measurement CI cannot take. Checkable: a workflow job that runs the live lane and can go red, with a linked run id — or a committed transcript plus the ADR stating why the runner cannot exist. (Ticked 2026-08-20: run 32332394990 red on suppressed proof line, run 32332179363 green; PR #31.)
- [x] Focus behaviour is measured on both an X11 and a Wayland session, with both transcripts linked, and an ADR states which guarantee the daemon makes. **Either outcome ticks this box** — a route that restores the keyboard, or a named limitation. What fails it is an unmeasured claim. (Ticked 2026-08-20: ADR-0044's "Amendment - the measurement was taken" section links both transcripts; the receipt below quotes the verdict lines; PR #32, [the-daemon-is-finished.md](proofs/the-daemon-is-finished.md).)
- [x] Gmail's inbox roles are either first-class neutral words or an ADR records why they remain diagnostic-only, with the measurement linked. **Either outcome ticks this box**; an unmeasured deferral does not. (Ticked 2026-08-20: schema 1.5.0 with ADR-0048, measurement grid 1 / row 100 / gridcell 137 on the signed-in inbox; PR #32.)
- [x] The schema's method descriptions do not contradict the daemon's behaviour. Checkable: no description of a routed method says it is refused until the seam carries it, and `node tools/freeze-gate.mjs` passes against the bumped version with its ADR. (Ticked 2026-08-20: all seven descriptions rewritten in the 1.5.0 bump, freeze-gate compliant; PR #32.)
- [x] No document claims work arrives "in this segment" or "in segment 3" for work that has landed. Checkable: a grep of the daemon package and its tests for segment language returns only historical references in dated documents. (Ticked 2026-08-20: nine sites swept; repo-wide grep of daemon, packages, tools, scripts, infra and protocol returns nothing outside dated documents; PR #33.)
- [x] The proofs index cannot silently omit an artifact. Checkable: `node scripts/check-docs.mjs` goes red when a file in `docs/proofs/` is not linked from the index. (Ticked 2026-08-20: proven red on purpose - `.proof/segment-5/proofs-index-red-green.txt`; PR #33.)
- [x] Proof artifact: `the-daemon-is-finished.md`, produced on real hardware, carrying a red/green pair for every segment that changed behaviour — including the segments whose work is tooling rather than wire behaviour. (Ticked 2026-08-20: [proofs/the-daemon-is-finished.md](proofs/the-daemon-is-finished.md), per-segment provenance stated inline; PR #33.)

---

## M3 — The hub thinks

**Goal:** an agent that can drive the daemon, with credentials it never hands out.

**Deliverables:**
- Hub with the transport package as its only daemon client.
- Minted, enumerated, read-only-by-default tool surface.
- Token minting with a short TTL and honest refusals for a missing account.
- The audit log: an append-only access record, written by the daemon at the point of effect ([ADR-0026](02-DECISIONS/0026-the-audit-log-is-an-access-record-episodes-are-the-narrative.md)).
- The stripped view long-term agent memory receives — the one redaction this milestone owes. Redaction proper is an episode concern at read time, and episodes are not in M3.
- The four lane events.

**Exit gate:**
- [ ] Boundary pins B2 and B5 pass, and each **fails** under its mutation. B3's **runtime** half — a client-side provider key is refused — passes and fails under its mutation; B3's **source** half is deferred to M4, which is the first milestone with a client package to scan.
- [ ] Digest agreement check passes; **fails** when the transport's embedded digest is altered.
- [ ] A text-only integration test drives a real daemon to read a real element.
- [ ] Proof artifact: `which-credential-the-voice-lane-accepts.md`.
- [ ] The audit log for that run names every element it **answered**, and nothing else.

---

## M4 — The face

**Goal:** the tray widget, correct on a real multi-monitor desk.

**Deliverables:** the window model and hiding model in [ADR-0016](02-DECISIONS/0016-the-face-is-a-managed-window-that-hides-when-told.md), in full.

**Exit gate — all verified live on the two-monitor X11 desk, not asserted:**
- [ ] `xwininfo` reports the window managed (not override-redirect).
- [ ] `xprop` shows the always-on-top state and the window present in the stacking list.
- [ ] A raised full-screen window does not bury the face.
- [ ] Dragging moves the face from one monitor to the other; placement survives a restart.
- [ ] A click on the orb sends a gesture; clicks in the transparent region send nothing.
- [ ] Disabling from the tray unmaps the window and removes it from the window list.
- [ ] The face stays visible for the whole of a long `progress` sequence.

---

## M5 — Wake

**Goal:** the wake gate works on Jamie's actual microphone, and the number that says so was measured on the path that ships.

**This is the milestone with a known unsolved problem.** See [ADR-0005 §5](02-DECISIONS/0005-wake-is-enrolment-first-fingerprinting.md).

**M0.5 left this milestone two things and no code, by design** (Q14–Q16 in [09-QUESTIONS.md](09-QUESTIONS.md)):

- **A structural suspect for the unexplained offset.** Every published system stages wake detection and speaker identification as separate mechanisms with separate thresholds; ours does both at once. That is exactly what would produce an offset between live captures and their own templates. It is a named suspect, not a diagnosis — but it is the first thing to test, before touching a threshold.
- **A licence blocker on the obvious dependency.** openWakeWord's *code* is Apache-2.0 while its shipped *pre-trained models* are CC BY-NC-SA — non-commercial, and therefore disqualified. A licence gate reading manifests would have passed it. Training a custom "hey mastra" model may resolve the licence and the custom-phrase requirement in one move, since the restriction lives in the weights rather than the framework. A second candidate's licence is genuinely disputed between two of its own sources; that is unresolved on purpose and closes by reading the LICENSE file at a pinned commit.

**Deliverables:**
- One capture path in `packages/voice`, consumed identically by the enrolment page and the live gate.
- Fingerprint matcher; window-invariant enrolment; live template re-fetch.
- Guided enrolment walkthrough with cue, countdown, auto-advance, per-take re-record, and a reset control.
- Factory bank for cold start.

**Exit gate:**
- [ ] The full measurement table from [ADR-0005](02-DECISIONS/0005-wake-is-enrolment-first-fingerprinting.md) **re-derived on the shipping capture path**, committed as `docs/proofs/what-the-wake-gate-admits.md`.
- [ ] Live scores against own templates sit **clearly inside** the threshold, with a stated margin. Not 0.4 outside it, and not fixed by moving the threshold.
- [ ] A fresh enrolment reaches the live detector **without restarting the widget** — demonstrated in the artifact.
- [ ] A second speaker is rejected.
- [ ] Boundary pin B9 passes and **fails** when a transcriber import is added — including one added only to a manifest.

**If the offset survives a single shared capture path, stop and investigate before tuning anything.** Raising the threshold is how the prototype stopped noticing.

---

## M6 — The north star

**Goal:** *"Tell me my most recent email."* Spoken, from across the room, answered aloud.

**Deliverables:** the end-to-end trace in [01-ARCHITECTURE.md §6](01-ARCHITECTURE.md), all nine steps. Voice session dial with a minted token; one semantic action against a real mail client; spoken answer; turn ends on silence or on a decline.

**Exit gate:**
- [ ] Proof artifact: `the-north-star-sentence.md`, produced on bigbeast, recording the phrase, the application, the elements read, and the spoken answer.
- [ ] The hub's audit log for that run shows the mail client and nothing else.
- [ ] A boundary check confirms no audio byte passed through the hub during the run.
- [ ] Saying *"no"* to a follow-up offer ends the turn and closes the microphone immediately.
- [ ] Re-waking starts a new conversation.

**This is the milestone that makes the project real.** Nothing below it is scheduled until it passes.

---

## M7 — Parallel

**Goal:** the factory rejoins, against a settled shape.

**Entry conditions, all required:**
- M6 passed with its artifact on disk.
- Agent platform pinned to a stable release, patches verified present. → [06-OPERATIONS.md §2](06-OPERATIONS.md)
- Board clean before the first dispatch.
- Every queued issue names its dependencies.

**Exit gate:**
- [ ] Ten agents complete work end to end with zero redundant dispatches.
- [ ] Zero merge-repair commits during the first wave.
- [ ] The keeper's live judgment shows requeues only for genuinely stalled rows.

---

## M8 — Ship one package

**Goal:** a stranger installs one `.deb` and reaches M6 in one sitting.

**Exit gate:**
- [ ] A clean Ubuntu VM installs the package and completes the six steps in [00-PRODUCT.md §10](00-PRODUCT.md).
- [ ] Performed by someone who did not build it.
- [ ] Every proof artifact re-run on the packaged build, not on a development tree.

---

## Deliberately not scheduled

Named so they are not mistaken for oversights, and so nobody re-derives them as new ideas.

| Item | When |
|---|---|
| Orb visual design beyond a legible face | after M6 |
| Phone client, as a full client | after M6 |
| Node-based skill editor (prototype issue #189) | after M7; needs the dashboard's React Flow surface |
| Windows port (prototype issue #16) | after M8 |
| App-native integration, compositor access, vision, raw input | deferred tiers; [01-ARCHITECTURE.md §8](01-ARCHITECTURE.md) |
| Launch-an-application tool (prototype issue #183) | **promoted, 2026-08-09** — no longer optional. [ADR-0027](02-DECISIONS/0027-the-assistant-opens-the-application-itself.md) makes launching *the* mechanism by which an application becomes readable, so this is a prerequisite for M2 rather than a convenience for later |

**The orb line is deliberate.** Four consecutive commits refined the prototype's orb — glass, wisps, smoke, reflection — in a single night, before the north star sentence worked. Visual work is scheduled after M6, on purpose.

**The phone line was corrected, 2026-08-08.** The phone *client* remains deferred. The **notification path is not**, and it has been promoted out of this table into M6. [ADR-0022](02-DECISIONS/0022-failure-to-act-is-harm-we-caused.md) makes reaching the user a safety mechanism rather than a convenience: if every protection must fail toward informing, then the thing that does the informing is load-bearing, and a milestone that can complete a task without being able to say so has not met the bar. M6 must therefore ship at least a stubbed notification path and a surface that shows a task is still running with its last checkpoint. Whether the person then answers from a phone, and how their answer is proven to come from them, is [ADR-0023](02-DECISIONS/0023-the-phone-is-a-consent-surface.md) and stays after M6.

---

## Decisions taken

Three questions were held open for Jamie while the documents were written. He took all three on the recommendation, 2026-08-08 — so they are settled, and a session reading this does not need to ask again.

1. **Wake capture — rebuild, do not port.** Port the *measurements*; rebuild the *capture path* once, in one place, shared by the enrolment page and the live gate; re-measure before trusting any constant. Porting the code as-is would inherit the unexplained live offset (20.4–21.3 against a threshold of 20) rather than explain it. → [ADR-0005](02-DECISIONS/0005-wake-is-enrolment-first-fingerprinting.md), M5.
2. **Vite plus the Mastra component library from commit one.** Yes. This was the direction on 2026-08-07 that never landed because the migration became a gate on itself. Known cost: `lucide-react` pins down to the `0.474.x` line the library peers on. → [ADR-0011](02-DECISIONS/0011-dashboard-is-vite-with-playground-ui.md), M1 and M4.
3. **Carry the protocol, the proofs, and the four good documents; retype everything else.** Copying code copies the assumptions that made it wrong. The prototype's generated tool API, security model, architecture notes, and prototype notes are worth migrating rather than re-deriving; no runtime source is copied. → M1 and M2.

**Superseded, 2026-08-08 — the factory question.** It previously read that the only open item was *when* to pin the factory. That is no longer the question. The fleet is deferred until the project has dependable tests, settled rules, and quality control, and its remit is narrowed to defects — things that are clearly not the intended behaviour. If there is no intended behaviour yet, the fleet does not get to invent it. → [ADR-0025](02-DECISIONS/0025-the-agent-fleet-only-fixes-defined-behaviour.md), which re-scopes M7.

**Decisions taken later the same day** are recorded as [ADR-0017](02-DECISIONS/0017-platform-backends-live-inside-the-daemon.md) through [ADR-0026](02-DECISIONS/0026-the-audit-log-is-an-access-record-episodes-are-the-narrative.md): cross-platform from commit one, a neutral protocol vocabulary, capability separated from authority, granting as a transaction, armable standing authority with non-waivable attestation, failure-to-act as harm, the phone as a consent surface, steerable tasks, the fleet's narrowed remit, and the audit log as an access record. Several of them rested on beliefs that M0.5 existed to probe, and the probing changed six of them.

**Decisions forced by M0.5's findings**, 2026-08-09, are [ADR-0027](02-DECISIONS/0027-the-assistant-opens-the-application-itself.md) through [ADR-0032](02-DECISIONS/0032-the-page-layer-is-an-instrument-not-a-gate.md): the assistant opens the application itself, trust as a mode whose default asks almost nothing, the daemon knowing what it launched, one Node process, the plan-and-interpreter execution model, and the page layer as an instrument rather than a gate. Each names the measurement that forced it. The ADR index says which kind each record is, and which were superseded.

---

## Receipts

| Claim | Source |
|---|---|
| issues closed on implementations that looked right | keeper merged and never deployed; PR #225 vs cron state |
| the prototype's own gate printed a failure and exited 0 | widget gate behaviour |
| live window verification method | PR #228 live run on a 3840×1080 two-monitor X11 desk |
| wake measurement table and constants | [ADR-0005](02-DECISIONS/0005-wake-is-enrolment-first-fingerprinting.md) |
| live scores 20.4–21.3 vs a threshold of 20 | live session, 2026-08-08 02:09 |
| threshold was raised twice | 18 → 20, `fingerprint.ts:64` |
| boot-snapshot bug meant a fresh enrolment never reached the detector | widget `ears.js`, fixed 2026-08-08 02:06 |
| four orb visual commits in one night | 2026-08-04 |
| factory bumps drop local patches | pnpm patched dependencies keyed to exact versions |
| dispatch-before-cleanup produced redundant work | 2026-08-07 17:56–18:13 |
| existing proof artifacts to re-derive | `docs/proofs/` |
| Vite direction predates the pivot | Jamie, 2026-08-07 17:04 and 17:52 |

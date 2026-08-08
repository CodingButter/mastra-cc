# 01 — Architecture

**Status:** normative for the skeleton. Changing anything in §3 (the repository layout) or §5 (the boundaries) requires an ADR in [02-DECISIONS/](02-DECISIONS/).
**Companion:** [00-PRODUCT.md](00-PRODUCT.md) says what we are building; this says where each part lives and who owns it.

---

## 1. The shape, in one picture

```
                       ┌──────────────────────────────────┐
   the person  ──────► │  CLIENTS                         │
   (voice, tray,       │  widget · phone page · dashboard │
    browser)           └───────────────┬──────────────────┘
                                       │  one transport package,
                                       │  spoken by every client
                                       ▼
                       ┌──────────────────────────────────┐
                       │  HUB  (the brain)                │
                       │  agents · tools · memory         │
                       │  credentials · audit · lanes     │
                       │  ZERO audio bytes                │
                       └───────────────┬──────────────────┘
                                       │  JSON-RPC 2.0 over a unix socket,
                                       │  keyed on the protocol schema digest
                                       ▼
                       ┌──────────────────────────────────┐
                       │  DAEMON  (the hands)             │
                       │  accessibility backends          │
                       │  scope enforcement · audit source│
                       └───────────────┬──────────────────┘
                                       ▼
                              the desktop session
```

And one flow that does *not* pass through the hub:

```
   device microphone ──► on-device wake gate ──► voice provider
                                  ▲
                                  │ short-lived minted token
                                  │ (the key stays in the hub)
                                HUB
```

That second diagram is the whole reason the first one says "ZERO audio bytes". See [ADR-0006](02-DECISIONS/0006-hub-holds-no-audio.md).

## 2. The three processes, and what each one is allowed to know

### Daemon — *the only thing that touches the desktop*

- Owns every read and write against the accessibility layer. No other process in the system may import an accessibility binding. This is enforced by a boundary test, not by convention (§7).
- Owns scope enforcement. A request arriving without the scope for its operation class is refused *at the daemon*, so a compromised or buggy hub cannot widen its own reach.
- Emits the change stream. The desktop talks first (prototype `08-01 10:07`); clients subscribe.
- Attributes every effect. A change is `external` (a human did it) or carries a cause id (the agent did it). This is what makes "the human outranks the agent" (issue #25) enforceable.
- Knows nothing about models, credentials, users, or voice.

**Runtime:** Python, single-threaded event loop, on the default GLib main context. Both of those are hard-won: the prototype notes record that the single-thread rule and the default-context choice each cost real time and produced silent event loss when violated (prototype `docs/08-prototype-notes.md`). Its venv must be created with `--system-site-packages` because the accessibility bindings are distribution packages, not wheels.

### Hub — *the brain, and the only place secrets live*

- Runs the agents and owns the tool surface handed to them.
- Holds credentials. Mints short-lived tokens for devices that need to dial a provider directly. The key itself never leaves.
- Owns the lanes (§4) and the session/turn state machine.
- Writes the audit log and the episode graph.
- Holds **no audio bytes, ever**.

**Runtime:** TypeScript on Node, Mastra agents and tools.

### Clients — *faces, ears, and mouths*

- The **widget** is the resident tray face: a small always-on-top window that listens for the wake phrase, shows who is talking, and speaks answers.
- The **phone page** is the same conversation from the couch.
- The **dashboard** is configuration, permissions, voice enrolment, and the audit view.

Clients hold no authority. A client asks; the hub decides; the daemon acts. A client that wants to know what is going on subscribes to a lane.

## 3. Repository layout

Decided before any feature code, because the prototype reorganised itself on day seven (PR #227: 179 files, 135 pure renames) and that rename broke three things that lived outside the repository. Getting this right on day one is cheaper than getting it right on day seven.

```
mastra-cc/
├── docs/                     # these documents; normative
│   └── 02-DECISIONS/         # ADRs
├── infra/                    # every machine-side fact, in the repo (ADR-0001)
│   ├── systemd/              # unit files
│   ├── sandbox/              # the setup command, as a script
│   └── apply.sh              # the one entry point that installs the above
├── protocol/
│   ├── schema.json           # the wire contract, one source of truth
│   ├── golden/               # frozen request/response fixtures
│   └── generate.mjs          # emits every binding
├── daemon/                   # Python; the only accessibility consumer
│   ├── src/
│   └── tests/
├── packages/
│   ├── transport/            # the daemon client every client speaks (ADR-0003)
│   ├── protocol-types/       # generated bindings; build output, not committed
│   └── voice/                # wake gate, fingerprint matcher, session dial
├── apps/
│   ├── hub/                  # the brain
│   ├── widget/               # Electron tray face
│   ├── dashboard/            # Vite + React config surface
│   └── phone/                # the couch client
└── tools/                    # repo scripts: proofs, generators, gates
```

### Three deliberate corrections to the prototype's layout

**`apps/` and `packages/`, not `client/` and `clients/`.** The prototype ended up with a `client/` directory (the hub, confusingly) sitting one letter away from `clients/` (the actual clients). Reading a path became guesswork. The hub is an app; shared code is a package; nothing is named a near-homograph of anything else.

**`infra/` exists from commit one.** Three separate outages in the prototype came from machine configuration that lived nowhere in the repository: a sandbox setup command stored in a Postgres column, a maintenance script kept in `~/bin`, and a memory ceiling set in a systemd unit. Each broke silently, each was invisible to every test in the tree, and one of them made a whole fleet unable to provision new work while looking perfectly healthy. See [ADR-0001](02-DECISIONS/0001-machine-config-lives-in-the-repo.md).

**Generated code is build output.** The prototype committed its generated bindings, so `schemas.generated.ts` (24 revisions) and `protocol_generated.py` (23) churned in lockstep with `schema.json` (23) — every protocol change produced a three-file diff of which two files were noise. Generate at build time; check the *generator* and the *golden fixtures* in; verify determinism in CI (§7).

## 4. The lanes

A lane is a named stream between hub and clients. The vocabulary is exact and is not to be paraphrased — the prototype's bugs in this area were all vocabulary drift.

| Lane event | Meaning |
|---|---|
| `progress` | the agent is working; here is what it is doing |
| `answer` | the agent has something to say to the person |
| `voice_opened` | a voice session became active somewhere |
| `voice_closed` | the last voice session ended |

Two rules the prototype learned the hard way, both of which cost a real bug:

1. **`voice_opened` / `voice_closed` are edges, so a joining client must be told the current state.** A widget that connects after the edge fired can never learn the state and sits in the wrong mode forever. Fix: on connect, the hub sends the current voice state to that client alone (PR #230).
2. **A connection that dies quietly must be counted down anyway.** A suspended laptop leaves a socket open to the kernel; the edge never fires; a machine stays deaf. Fix: the lane asks — every connection is pinged on an interval, and a peer that still owes an answer at the next sweep is hung up through the existing cleanup path (PR #230). The heartbeat deliberately does **not** count as the session having said something, because pongs are answered by the transport, not by page code — counting them would report a frozen face as freshly active.

## 5. The boundaries

Each boundary below is a rule, a reason, and a test. If it has no test, it is a wish. All tests named here are required by [05-TEST-STRATEGY.md](05-TEST-STRATEGY.md).

| # | Boundary | Enforced by |
|---|---|---|
| B1 | Only the daemon imports accessibility bindings | source-level test over every non-daemon package |
| B2 | The hub imports no audio API and holds no audio buffer | source-level test over the hub package |
| B3 | Clients hold no provider credential; they receive minted tokens only | source-level test + a runtime test that a client-side key is refused |
| B4 | Exactly one microphone consumer per client process | source-level test per client package |
| B5 | Every client reaches the daemon through `packages/transport` | source-level test: no second socket implementation anywhere |
| B6 | The protocol schema changes only through a reviewed gate | CI job (ADR-0002) |
| B7 | Generated bindings are reproducible from the schema | CI regenerates and diffs |
| B8 | No `xdotool`, `wmctrl`, or `uinput` anywhere | source-level test over the whole tree |
| B9 | No transcriber in any client | source-level test (ADR-0005) |

Two notes on how to write these, from prototype experience:

- **A source-level test must assert its own file list is non-empty.** The prototype added a boundaries suite to the dashboard and discovered the widget's equivalent had never covered the dashboard package at all — the rule was "habit, not a rule". A glob that matches nothing passes vacuously and reports success (PR #226).
- **A source-level test must strip comments before grepping.** Otherwise a paragraph explaining why the transcriber is gone fails the test that says the transcriber is gone.

## 6. Data flow: the north star sentence, end to end

Tracing *"tell me my most recent email"* through the boundaries, because a diagram that cannot survive one real sentence is decoration.

1. **Wake.** The widget's ear chain scores incoming audio against the user's enrolled voice templates, on-device. No audio leaves the machine. The chain is: amplitude gate → fingerprint match against the template bank → open. The bank is fetched from the hub and **re-fetched, not snapshotted at boot** — a boot-time snapshot means a fresh enrolment cannot reach the live detector without a restart, which is a real bug the prototype shipped and later fixed.
2. **Consent gesture.** `getUserMedia` succeeding at ears-start *is* the consent gesture. There is no second prompt, because the browser already asked.
3. **Session open.** The widget asks the hub for a token. The hub mints one scoped to a new session window, with a short TTL. If the user has no provider account attached, the hub answers `409 NO_GOOGLE_ACCOUNT` — an honest refusal, not a silent failure.
4. **Dial.** The device dials the provider *directly* with that token. Audio flows device ↔ provider. The hub sees text and control frames only.
5. **Intent.** The provider returns an intent; the hub's agent takes over. `voice_opened` goes out on the lane; every other client's ears unplug so one machine's speakers cannot feed another's microphone.
6. **Resolve.** The agent asks the daemon to find the mail application semantically — by role and name, not by coordinates — within the set of applications the user has permitted. An unpermitted application is not visible to this query at all.
7. **Read.** The daemon reads the message list and the message body through the accessibility tree, under `observe` scope. Every element touched lands in the audit log.
8. **Answer.** The hub emits `answer` on the lane. The device speaks it. The face shows who is talking.
9. **Close.** The turn ends on silence, or because the person said something that means *stop* — a decline is a complete turn, and ending the session closes the microphone gate rather than letting a silence timer run out (PR #231). `voice_closed` goes out; other clients' ears unplug. The wake word stays armed: being told *no* ends the conversation, not the wake word.

Every step above is a place a boundary from §5 applies. That is the point of the trace.

## 7. What the build enforces

CI is the only place a rule becomes real. The gates, in the order they run:

1. **Protocol determinism.** Regenerate every binding from `schema.json`; fail on any diff. Catches a hand-edited generated file — which the prototype did suffer, in the vendored copy.
2. **Protocol freeze.** If `protocol/schema.json` changed, the job fails unless the change carries an accepted ADR and updated golden fixtures. See [ADR-0002](02-DECISIONS/0002-schema-freeze-is-a-ci-job.md).
3. **Boundaries.** Every test in §5.
4. **Unit and integration suites** per package.
5. **Typecheck** per TypeScript package, `--noEmit`, with the package's own `tsc` — never a floating one.
6. **Build** for anything that ships a bundle. The prototype had a package where tests and typecheck were green while the build was broken, because the bundler needed alias configuration the test runner did not. A green test suite is not a green build.
7. **Mutation checks** on the small number of rules that are load-bearing and cheap to invert. See [05-TEST-STRATEGY.md](05-TEST-STRATEGY.md).

## 8. Deliberately deferred

Named here so nobody re-derives them as new ideas. All four are recorded in the prototype's open-questions document as deferred tiers.

- **App-native integration** — talking to an application's own API instead of its accessibility tree.
- **Compositor-level access** — Wayland-native protocols beyond what the accessibility layer offers.
- **Vision** — pixels as a *reasoning* input rather than a last-resort addressed capture.
- **Raw input synthesis** — explicitly out of scope, not merely deferred (B8).

## 9. Open architectural questions

Real, unresolved, and each one needs a decision before the code that depends on it:

1. **Wake capture path.** The measurements are solid: enrolment-first fingerprinting admits about 82% of a person's own unseen takes at zero false accepts, with a threshold of 20 and an enrolled-template weight of 1.15. But on the live microphone the same person's voice scored 20.4–21.3 against their own templates — a systematic offset just over the line, not random noise. The measurement rig and the live capture path were built separately, and that is the suspect. **Decision needed:** rebuild capture once, in one place, shared by the enrolment page and the live gate, and re-measure. See [ADR-0005](02-DECISIONS/0005-wake-is-enrolment-first-fingerprinting.md).
2. **Where the phone client's transport terminates.** Direct to hub, or through a relay when the person is off their network.
3. **Episode storage.** Episodes-as-git was right; whether the graph lives beside the audit log or inside it was never settled.

---

## Receipts

| Claim | Source |
|---|---|
| reshape = 179 files / 135 pure renames | PR #227 |
| generated files churn with the schema (24 / 23 / 23) | `git log` counts on `schemas.generated.ts`, `protocol_generated.py`, `schema.json` |
| single-thread + default GLib context, `--system-site-packages` | prototype `docs/08-prototype-notes.md` |
| the desktop talks first | commit `08-01 10:07` |
| lane vocabulary | prototype hub lane implementation; used verbatim throughout |
| joining client told current voice state; ping/hang-up sweep; pongs don't count as activity | PR #230 (closes issue #206) |
| a decline ends the turn and closes the mic gate | PR #231 (closes issue #223) |
| boundary suite passed vacuously; comment-stripping needed | PR #226 (closes issue #222) |
| `409 NO_GOOGLE_ACCOUNT`, short-lived minted tokens | hub token-mint implementation |
| deferred tiers | prototype `docs/07-open-questions.md` |
| wake numbers: threshold 20, weight 1.15, 82% own-voice at zero FA | `fingerprint.ts:64`, enrolment measurement runs |
| live scores 20.4–21.3 against own templates | live widget scoring session, 2026-08-08 |

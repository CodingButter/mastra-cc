# 01 — Architecture

**Status:** normative for the skeleton. Changing anything in §3 (the repository layout) or §5 (the boundaries) requires an ADR in [02-DECISIONS/](02-DECISIONS/).
**Amended 2026-08-28 ([ADR-0057](02-DECISIONS/0057-mastra-cc-is-a-peripheral-not-an-assistant.md)):** the hub, widget, dashboard and voice packages were removed. §1–§5 describe the peripheral as it stands; §6 is kept as a historical trace of the retired assistant and is no longer normative.
**Companion:** [00-PRODUCT.md](00-PRODUCT.md) says what we are building; this says where each part lives and who owns it.

---

## 1. The shape, in one picture

```
                       ┌──────────────────────────────────┐
   an agent runtime ──►│  CONSUMER  (installable package) │
   (Mastra, or any     │  the tool surface · the skills   │
    other caller)      │  ZERO desktop access of its own  │
                       └───────────────┬──────────────────┘
                                       │  one transport package
                                       │
                                       │  JSON-RPC 2.0, keyed on the protocol
                                       │  schema digest, over EITHER
                                       │    · a unix socket (default), or
                                       │    · a websocket, when the daemon is
                                       │      not on this filesystem
                                       ▼
                       ┌──────────────────────────────────┐
                       │  DAEMON  (the hands)             │
                       │  accessibility backends          │
                       │  scope enforcement · audit source│
                       └───────────────┬──────────────────┘
                                       ▼
                              the desktop session
```

The two addresses are two front doors onto one protocol, not two protocols: a
single per-connection handler serves both, and the bytes are identical down to
the trailing newline. The websocket door is off unless `--ws-port` opens it, and
binds loopback unless `--ws-host` widens it
([ADR-0058](02-DECISIONS/0058-the-daemon-serves-one-protocol-through-two-front-doors.md)).

There is no third process. A face, a voice, a phone page — any of those is a
*consumer* built on top of this, in somebody else's repository, and none of them
is our concern ([ADR-0057](02-DECISIONS/0057-mastra-cc-is-a-peripheral-not-an-assistant.md)).

## 2. The two halves, and what each one is allowed to know

### Daemon — *the only thing that touches the desktop*

- Owns every read and write against the accessibility layer. No other process in the system may import an accessibility binding. This is enforced by a boundary test, not by convention (§7).
- Owns every backend behind one seam ([ADR-0017](02-DECISIONS/0017-platform-backends-live-inside-the-daemon.md)): the Linux accessibility backend reads the platform bus (M1), the browser backend reads a Chromium's own debugging protocol ([ADR-0035](02-DECISIONS/0035-the-browser-is-read-through-its-own-protocol.md), M2.2), and each ships with a replay twin that answers the offline test lane from a captured tape. The wire cannot tell which backend answered — the vocabulary is neutral by [ADR-0018](02-DECISIONS/0018-the-protocol-speaks-a-neutral-element-vocabulary.md).
- Owns scope enforcement. A request arriving without the scope for its operation class is refused *at the daemon*, so a compromised or buggy hub cannot widen its own reach. Since M2.3 this is concrete on both axes: application visibility is deny-by-default — grants live in a daemon-local permissions file ([ADR-0036](02-DECISIONS/0036-grants-live-in-a-file-the-daemon-owns.md)), union-composed at boot with session `--grant` flags and `--permit` names, and an ungranted application's subtree is never read (the walk skips it at enumeration; only its name is ever touched, to decide). And the wire defines `editElement`, `activateElement` and `submitElement` (schema 1.2.0, [ADR-0037](02-DECISIONS/0037-the-other-three-classes-are-on-the-wire-before-they-are-possible.md)) as refused-by-name methods — the scope gate answers each with a byte-stable refusal naming the check, and no backend is ever touched. Since M2.3b the unit those names denote is finer for a browser: a **launch identity** is a name in the launch catalog, and a browser profile is one ([ADR-0038](02-DECISIONS/0038-a-browser-profile-is-a-launch-identity.md)). Named profiles live in a second daemon-local file the operator owns, each binding a name to a profile directory; the daemon composes one launch recipe per name and permitting `chrome-work` is not permitting `chrome` — the two are refused apart, byte-identically to a name that does not exist. Because a browser launched under any profile still calls itself `chrome` to the debugging protocol, the launch poll joins the catalog key to the name the tree answers to, and *that* join is expanded on the observe side only: authority is never widened by it. Current element content is exposed only after that grant admits the walk ([ADR-0056](02-DECISIONS/0056-permitted-content-is-observable-protected-content-is-redacted.md), schema 1.6.0): ordinary text and numeric controls carry a provider-neutral observation; controls marked protected by the platform carry only a structured redaction and are not read for a value. Internal mutation read-back still refuses disagreement, while caller-visible certainty comes from freshly querying or attesting the element after the mutation.
- Emits the change stream. The desktop talks first (prototype `08-01 10:07`, [ADR-0039](02-DECISIONS/0039-the-desktop-talks-first.md), schema 1.3.0, M2.4); a client subscribes to **one element's subtree** at a declared priority and is pushed change events until it unsubscribes, the connection closes, or the watched element ceases to exist — that last case ends the watch with a terminal event naming the element, never a silent re-anchor. Scope is the design: a watch on one subtree is the difference between being told what matters and being told everything. The priority label is carried back on every event and **never interpreted** — the daemon has no notion of what a client does with it. Events are pointers, never payloads: `{id, role, kind}` and the attribution, no name, value, text, or content observation ([ADR-0032](02-DECISIONS/0032-the-page-layer-is-an-instrument-not-a-gate.md) clause 2). Visibility is re-checked at emission — a change inside an ungranted application is not filtered-with-a-notice, it is never emitted at all.
- Writes the audit log ([ADR-0026](02-DECISIONS/0026-the-audit-log-is-an-access-record-episodes-are-the-narrative.md), M3). Every read and every effect it performs against the desktop leaves one append-only entry naming the application, the element's **identity**, the scope it was permitted under, the cause, the attestation where one was required, and the outcome. The entry never carries element content: permitted ordinary observations are returned only in semantic element results, protected observations are redacted, and audit remains a record of access rather than application data ([ADR-0056](02-DECISIONS/0056-permitted-content-is-observable-protected-content-is-redacted.md)).
- Attributes every effect, with exactly three values. A change is `self` (this daemon's open verb caused it — carries that cause id), `external` (nothing was in flight; a human or another program did it), or `unattributed` (a verb was in flight but does not bind to the changed element's application — the daemon abstains instead of guessing, [ADR-0032](02-DECISIONS/0032-the-page-layer-is-an-instrument-not-a-gate.md) clause 5). An unmatched effect is recorded as news, never flagged as an alarm. This is what makes "the human outranks the agent" (issue #25) enforceable.
- Knows nothing about models, credentials, users, or voice.
- Owns where it can be reached from, and nothing about who reaches it. A unix socket always; a
  websocket as well when `--ws-port` asks for one, bound to loopback unless `--ws-host` widens
  it ([ADR-0058](02-DECISIONS/0058-the-daemon-serves-one-protocol-through-two-front-doors.md)).
  Both doors run the same per-connection handler over the same bytes, so no capability, refusal
  or scope check differs by address. Authentication is deliberately absent: the daemon states
  its posture and leaves who-may-connect to whoever composes a product on top.

**Runtime:** Node, single-threaded, one process ([ADR-0030](02-DECISIONS/0030-the-daemon-is-one-node-process.md)). The **single-thread rule survives, and the reason it survives changed** — the prototype recorded it as a docstring claiming *silent corruption*; M0.5 measured a deterministic `SIGTRAP` abort at two or more concurrent threads, eight runs on the first machine and a control plus two repeats on a second ([is the accessibility binding thread-safe](proofs/is-the-accessibility-binding-thread-safe.md)). **That receipt was taken through `libatspi`, which this daemon does not load** — the raw D-Bus route is unmeasured under concurrency, and M1 owes the measurement ([ADR-0030](02-DECISIONS/0030-the-daemon-is-one-node-process.md) clause 3). The rule is kept on its own merits meanwhile: one owner for accessibility access is what makes an audit record attributable. The *language* did not survive: AT-SPI is plain D-Bus underneath, and Node reached read, write and events without a Python binding. There is no venv and no GLib main context, so `--system-site-packages` no longer applies.

### Consumer — *the caller, and the only place judgment lives*

- Speaks the protocol through `packages/transport` and nothing else. It holds no
  accessibility binding, opens no second socket, and has no authority the daemon did not
  already grant its session.
- Owns the tool surface handed to a model, and the instructions that say how to read an
  application, walk a tree, and recognise the footguns. That is taste, and it drifts with
  models; the daemon is engineering, and it is done per release. They version separately.
- Holds credentials for whatever *it* talks to. The daemon holds none and wants none.
- The daemon writes the audit log — at the point of effect, because a record of what the
  desktop was asked to do belongs where the asking happens
  ([ADR-0026](02-DECISIONS/0026-the-audit-log-is-an-access-record-episodes-are-the-narrative.md)).
  A consumer cannot write it, edit it, or turn it off.

**Runtime:** TypeScript on Node, published as an ordinary npm dependency.

## 3. Repository layout

Decided before any feature code, because the prototype reorganised itself on day seven (PR #227: 179 files, 135 pure renames) and that rename broke three things that lived outside the repository. Getting this right on day one is cheaper than getting it right on day seven.

```
mastra-cc/
├── docs/                     # these documents; normative
│   └── 02-DECISIONS/         # ADRs
├── infra/                    # every machine-side fact, in the repo (ADR-0001)
│   ├── config/, keeper/      # restrictive seeds and installed health check
│   ├── units/                # systemd user units; boot composition lives here
│   └── apply.sh              # installs repo artifacts and seeds missing operator files
├── protocol/
│   ├── schema.json           # the wire contract, one source of truth
│   ├── golden/               # frozen request/response fixtures
│   └── generate.mjs          # emits every binding
├── daemon/                   # Node; the only accessibility consumer
│   ├── src/
│   └── tests/
├── packages/
│   ├── transport/            # the daemon client every consumer speaks (ADR-0003)
│   └── protocol-types/       # generated bindings incl. their own tsconfig; builds its
│                             #   declarations into dist/; build output, not committed
└── tools/                    # repo scripts: proofs, generators, gates
```

### Three deliberate corrections to the prototype's layout

**`apps/` and `packages/`, not `client/` and `clients/`.** The prototype ended up with a `client/` directory (the hub, confusingly) sitting one letter away from `clients/` (the actual clients). Reading a path became guesswork. The hub is an app; shared code is a package; nothing is named a near-homograph of anything else.

**`infra/` exists from commit one.** Three separate outages in the prototype came from machine configuration that lived nowhere in the repository: a sandbox setup command stored in a Postgres column, a maintenance script kept in `~/bin`, and a memory ceiling set in a systemd unit. Each broke silently, each was invisible to every test in the tree, and one of them made a whole fleet unable to provision new work while looking perfectly healthy. See [ADR-0001](02-DECISIONS/0001-machine-config-lives-in-the-repo.md).

**Generated code is build output.** The prototype committed its generated bindings, so `schemas.generated.ts` (24 revisions) and `protocol_generated.py` (23) churned in lockstep with `schema.json` (23) — every protocol change produced a three-file diff of which two files were noise. Generate at build time; check the *generator* and the *golden fixtures* in; verify determinism in CI (§7).

## 4. The lanes — *removed*

A lane was a named stream from the hub to a human face: `progress`, `answer`, `voice_opened`,
`voice_closed`. Every consumer of it was amputated with the client surface, so
`packages/transport/src/lane.ts` went with them
([ADR-0057](02-DECISIONS/0057-mastra-cc-is-a-peripheral-not-an-assistant.md), superseding
[ADR-0052](02-DECISIONS/0052-the-lane-carrier-is-transports-second-wire.md)). A four-word
vocabulary with nobody listening is a ghost, not an interface. The two lessons it cost —
that an edge event must be replayed to a joining peer, and that a quietly dead connection
must still be counted down (PR #230) — are recorded here so the next streaming surface does
not relearn them.

## 5. The boundaries

Each boundary below is a rule, a reason, and a test. If it has no test, it is a wish. All tests named here are required by [05-TEST-STRATEGY.md](05-TEST-STRATEGY.md).

| # | Boundary | Enforced by |
|---|---|---|
| B1 | Only the daemon imports accessibility bindings | source-level test over every non-daemon package |
| B5 | Every consumer reaches the daemon through `packages/transport` | source-level test: no second client implementation anywhere, neither a `node:net` socket nor the `ws` server library (ADR-0058); import-scoped, so a global-`WebSocket` dial is outside its reach |
| B6 | The protocol schema changes only through a reviewed gate | CI job (ADR-0002) |
| B7 | Generated bindings are reproducible from the schema | CI regenerates and diffs |
| B8 | `xdotool`, `wmctrl` and `uinput` only inside the raw-input operation class | source-level test over the whole tree (ADR-0046) |
| B10 | No platform-specific vocabulary in `protocol/schema.json` | source-level test over the schema (ADR-0018) |
| B11 | No effect-class operation relies solely on post-hoc enforcement | source-level test over the daemon's dispatch table |
| B12 | Every dependency carries a permissive licence | CI job over the shipped runtime closure and every declared development dependency, against an allowlist |

**Which of these exist:** five source pins are wired — B1, B5, B8, B10 and B11 — plus B6 and
B7 as CI steps and B12 as its own CI job. B11 arrived with M2.1's `openApplication`, in the
same commit as the first effect-class dispatch entry, as required.

**B2, B3, B4 and B9 were retired on 2026-08-28.** All four were rules about a client
surface — no audio in the hub, no provider credential in a client, one microphone consumer
per client, no transcriber in a client — and that surface no longer exists
([ADR-0057](02-DECISIONS/0057-mastra-cc-is-a-peripheral-not-an-assistant.md)). They were
deleted rather than left scanning an empty tree, because a pin over zero files is a green
light that means nothing. [tools/pins/README.md](../tools/pins/README.md) records the
surviving wiring.

**B10** keeps a platform's words out of the wire. Each backend owns its own native→neutral
map, so a role named after one toolkit's widget set cannot leak into a protocol that three
platforms have to speak. It costs nothing today and saves a version bump later.

**B11** is the enforcement-timing rule, and it is the one most likely to be broken by
someone being helpful. Permission may be enforced in two places: before a call runs, or on
the result it returns. Result-time enforcement is legitimate for `observe`, and it is how
`permitted-unreadable` is reported honestly rather than as absence. It is *illegitimate*
for `edit`, `activate`, `submit` and `destructive`, because by the time there is a result
to filter, the effect has already happened. A redacted confirmation does not unsend an
email. The dispatch table must therefore mark every effect-class operation as
enforced-before-call, and the test must fail if one is not.

**B12** exists because this is intended to land in an Apache-2.0 tree, so "free" is not the
test — compatible is. The allowlist is MIT, BSD, Apache-2.0 and ISC. Two notes: a
dependency the operating system already provides and which we merely require, rather than
ship, is outside the allowlist's reach and should be recorded as such with its reason; and
a permissive licence on an abandoned project is a different problem that this gate does not
catch, so adoption records a maintenance note as well as a licence.

Two notes on how to write these, from prototype experience:

- **A source-level test must assert its own file list is non-empty.** The prototype added a boundaries suite to the dashboard and discovered the widget's equivalent had never covered the dashboard package at all — the rule was "habit, not a rule". A glob that matches nothing passes vacuously and reports success (PR #226).
- **A source-level test must strip comments before grepping.** Otherwise a paragraph explaining why the transcriber is gone fails the test that says the transcriber is gone.

## 6. Data flow: the north star sentence, end to end

> **Retired 2026-08-28 — historical record, not normative.** Every actor above the daemon in
> this trace (widget, hub, voice gate) was removed by
> [ADR-0057](02-DECISIONS/0057-mastra-cc-is-a-peripheral-not-an-assistant.md). Steps 7 and 8
> — semantic resolution and scoped reading — are still exactly what the daemon does, and are
> the only part of this section that still describes shipped code. The rest is kept because
> [ADR-0053](02-DECISIONS/0053-phrase-wake-gates-a-client-owned-voice-session.md) and
> [ADR-0054](02-DECISIONS/0054-gmail-authority-is-composed-by-the-operator-unit.md) cite it.

Tracing *"tell me my most recent email"* through the boundaries, because a diagram that cannot survive one real sentence is decoration.

1. **Phrase wake.** Chromium supplies the widget's one echo-cancelled microphone stream. The widget scores “Hey Mastra” locally; no transcript or speaker identity participates.
2. **Provisional opening.** The widget buffers one bounded, complete utterance in memory and shows that it is listening.
3. **Dial.** The widget asks the hub for a single-use provider token. If no account is configured, the hub returns an honest refusal. No audio crosses the hub.
4. **Realtime admission.** The widget opens one constrained Gemini Live session, sends the buffered opening once as paced frames, and marks it complete. The model initially has exactly `admit_conversation` and `stop_listening`; audio output and live microphone continuation remain blocked until one valid terminal admission decision wins.
5. **Active conversation.** `voice_opened` goes out on the lane. The existing microphone source attaches to the same provider session. Follow-up speech needs no wake or second admission decision, and actual speech alone refreshes the 60-second inactivity clock.
6. **Request.** Gemini sends a request signal to the background orchestrator; it has no desktop tools and no execution authority. Priority-aware sanitized result signals return without interrupting model speech.
7. **Resolve.** The orchestrator asks the daemon to find the mail application semantically — by role and name, not coordinates — within the set of applications the user permitted. Conversational admission granted no authority; sensitive operations are authorized here, at execution.
8. **Read.** The daemon reads the message list and body through the accessibility tree under `observe` scope. Every element the daemon **answers** lands in the audit log; an element the query discarded does not ([ADR-0050](02-DECISIONS/0050-the-record-names-the-refusal-not-the-sentence.md)).
9. **Answer.** The orchestrator sends sanitized execution truth to Gemini. The client plays Gemini's answer through Chromium's Web Audio graph while WebRTC echo cancellation keeps that output from returning as user speech.
10. **Close.** “Never mind”, `stop`, provider failure, or 60 seconds without actual speech closes the provider and global voice session exactly once. `voice_closed` goes out; unrelated work continues, and phrase wake remains armed.

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
- **Raw input synthesis** — *was* explicitly out of scope; as of 2026-09-01 a strictly bounded form is in, and B8 is what bounds it. One named chord from a closed list, addressed to one element, under a capability that is off until an operator passes `--allow rawInput`, never reachable from a refused semantic verb, and contained by B8 to a single directory rather than forbidden everywhere ([ADR-0046](02-DECISIONS/0046-raw-input-is-the-most-restricted-class-not-a-banned-one.md), [ADR-0067](02-DECISIONS/0067-a-chord-is-a-closed-list-and-the-desk-is-read-back-afterwards.md)). Everything else the phrase covers stays out: no pointer, no free-form key stream, no window raising, no coordinate anywhere.

## 9. Open architectural questions

Real, unresolved, and each one needs a decision before the code that depends on it:

1. **Episode storage.** Episodes-as-git was right; whether the graph lives beside the audit log or inside it was never settled. Whichever way it goes decides whether redaction happens at write time or at read time — see [ADR-0013](02-DECISIONS/0013-episodes-are-a-git-graph.md).

**Superseded, 2026-08-25 — biometric wake admission.** The enrolment-first measurements remain useful evidence, including their failure to generalize reliably to live speakers. M5 replaced speaker-specific admission with local phrase wake, bounded provisional capture, and a constrained client-owned realtime admission session. The old measurements and rationale remain in [ADR-0005](02-DECISIONS/0005-wake-is-enrolment-first-fingerprinting.md); the current ownership and privacy boundaries are [ADR-0053](02-DECISIONS/0053-phrase-wake-gates-a-client-owned-voice-session.md).

---

## M6 boot composition

For M6, `infra/units/mastra-desktop-daemon.service` is the boot-composition owner ([ADR-0054](02-DECISIONS/0054-gmail-authority-is-composed-by-the-operator-unit.md)). It joins four authorities without merging their ownership: unit `--permit` supplies session launch authority; the operator grants file records explicit observe intent; the operator capabilities file subtracts durable per-application launch capability; and the unit supplies the audit destination because the daemon deliberately has no default. `infra/apply.sh` installs the complete repository-owned daemon module tree, but only seeds missing operator files under `%h/.config/mastra-cc/`; later edits remain the operator's bytes. No consumer and no model owns any of this composition.

---

## The accessibility layer is a machine-scoped authority

A desktop whose accessibility layer is switched off answers every query with nothing, which reads
exactly like an empty desktop. `describeAccessibility` makes that state a reported fact — `enabled`,
`disabled`, or `cannot-tell` with a reason — behind a platform adapter, so no platform's vocabulary
reaches a caller ([ADR-0064](02-DECISIONS/0064-the-desk-says-whether-it-can-be-heard.md)).

Switching the layer on changes the operator's machine rather than one application, so it is **not** a
capability: `capabilityNames` is answered once per application, and a per-application key for a
machine-wide switch would say one application can be made audible and another not. It is held by the
`--acquire-accessibility` launch flag instead, default off, in the shape the grants file already uses
for `observe`. Without the flag `acquireAccessibility` refuses as `disabled-by-configuration` naming
the flag; on a platform with no adapter it refuses as not-acquirable. Nothing the agent sends reaches
either decision, and the state reported after an acquire is re-read from the layer rather than
asserted from the attempt.

---

## Receipts

| Claim | Source |
|---|---|
| reshape = 179 files / 135 pure renames | PR #227 |
| generated files churn with the schema (24 / 23 / 23) | `git log` counts on `schemas.generated.ts`, `protocol_generated.py`, `schema.json` |
| single-thread rule | prototype `docs/08-prototype-notes.md`, then **measured** — [is the accessibility binding thread-safe](proofs/is-the-accessibility-binding-thread-safe.md) |
| the desktop talks first | commit `08-01 10:07` |
| lane vocabulary | prototype hub lane implementation; used verbatim throughout |
| joining client told current voice state; ping/hang-up sweep; pongs don't count as activity | PR #230 (closes issue #206) |
| a decline ends the turn and closes the mic gate | PR #231 (closes issue #223) |
| boundary suite passed vacuously; comment-stripping needed | PR #226 (closes issue #222) |
| `409 NO_GOOGLE_ACCOUNT`, short-lived minted tokens | hub token-mint implementation |
| deferred tiers | prototype `docs/07-open-questions.md` |
| wake numbers: threshold 20, weight 1.15, 82% own-voice at zero FA | `fingerprint.ts:64`, enrolment measurement runs |
| live scores 20.4–21.3 against own templates | live widget scoring session, 2026-08-08 |

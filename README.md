# Mastra CC

A voice-first agent that operates your Linux desktop the way a person does — by asking the desktop what is on it, and acting on the things it names.

You say *"Hey Mastra."* A small face appears in the corner. You say *"tell me my most recent email."* It finds the mail window, works out which message is newest from what Gmail itself publishes — never from where a row happens to sit — and tells you, or says plainly that it could not tell. It never took a screenshot to do that, and it never typed anything you did not ask for.

**Status: M5 delivered; M6 Stages 1 through 3 delivered.** M0 (documents), M0.5 (research), M1 (skeleton), M2 through M4, and M5 (wake) are built; the plan still came first, and the reason it did is written down in [`docs/03-LESSONS.md`](docs/03-LESSONS.md). M6 now has its frozen north-star contract, exact operator-owned Gmail authority composition, and a trusted non-model orchestration seam that delegates launch decisions to the daemon. It does not yet launch Gmail or traverse an inbox.

---

## Where this came from

A working prototype exists: 332 commits, 127 pull requests, 105 issues, built in seven days. It works. It proved the hard parts — the semantic control model, the consent model, wake-word fingerprinting, the voice lane, the tray face.

It also cost far more rework than it should have. Not because of velocity and not because of throughput — **rework was the constraint.** Three failure families produced nearly all of it, and all three are structural:

1. **Repo↔host seams.** Configuration that lived outside the repository — a setup command in a database column, a scheduled script in a home directory, a memory limit in a service unit — broke silently. No test in the tree could see it. The fleet looked healthy while being unable to grow.
2. **Guessing instead of reading.** Hours were spent sending a wrong enum value to an API whose parser was sitting on disk, readable, the whole time. Twelve automated wake-ups were blamed on a human being slow. The human was a typo.
3. **Duplicated truth.** The same module lived in three places, kept in sync by parity tests. The parity tests worked. The duplication was still a tax on every change.

Every document here exists to make one of those families structurally impossible, and every claim in them carries a citation to the commit, pull request, or issue that taught it.

---

## Read these in order

| Doc | What it answers |
|---|---|
| [00-PRODUCT.md](docs/00-PRODUCT.md) | What this is, who it is for, and what it refuses to become |
| [01-ARCHITECTURE.md](docs/01-ARCHITECTURE.md) | The three layers, every boundary, and who owns what |
| [02-DECISIONS/](docs/02-DECISIONS/README.md) | Thirty-two ADRs: 0001-0016 back-filled from prototype evidence, 0017-0026 forward decisions, 0027-0032 forced by what M0.5 measured |
| [03-LESSONS.md](docs/03-LESSONS.md) | What went wrong, categorised, and the rule each failure buys |
| [04-INTEGRATION-PLAN.md](docs/04-INTEGRATION-PLAN.md) | How this drops into the Mastra monorepo without a rewrite |
| [05-TEST-STRATEGY.md](docs/05-TEST-STRATEGY.md) | Boundary pins, mutation tests, proof artifacts, the live lane |
| [06-OPERATIONS.md](docs/06-OPERATIONS.md) | Running the factory: dispatch, the keeper, board vocabulary, pinned versions |
| [07-ROADMAP.md](docs/07-ROADMAP.md) | Milestones, each with a gate that can fail |
| [08-GLOSSARY.md](docs/08-GLOSSARY.md) | Exact vocabulary. Several prototype bugs were vocabulary bugs |
| [09-QUESTIONS.md](docs/09-QUESTIONS.md) | What we still do not know, and what counts as finding out |

**If you are a fresh session with fifteen minutes:** read 00, then 01, then the [ADR index](docs/02-DECISIONS/README.md), then [CONTRIBUTING.md](CONTRIBUTING.md). That is enough to make a correct first change.

**If you are about to write code:** you also need [05-TEST-STRATEGY.md](docs/05-TEST-STRATEGY.md) and [07-ROADMAP.md](docs/07-ROADMAP.md), because the roadmap says which milestone you are in and the milestone says which gate must pass.

**Where the work actually starts.** M0 (documents) closed 2026-08-08. **M0.5 (research) closed 2026-08-09** — all twenty questions closed plus six added, sixteen measurement artifacts in [docs/proofs/](docs/proofs/), six decision records forced by findings and six earlier ones superseded. Its spike code was deleted, as that milestone required from the start. **M1 (skeleton) is built**: the workspace and toolchain pins, `protocol/schema.json` v1.0.0 behind a freeze gate proven red and green in CI, a Node daemon with a real Linux accessibility backend and a replay backend answering from recorded fixtures, and a hub that read a real element off a real desktop through the full stack. The concurrency debt M0.5 recorded is paid — 27 runs on the Node route, no aborts, artifact in [docs/proofs/](docs/proofs/).

**What M5 shipped**, per [ADR-0053](docs/02-DECISIONS/0053-phrase-wake-gates-a-client-owned-voice-session.md): phrase-only wake with no transcription and no speaker identity; one bounded, complete opening buffered locally and handed to a constrained realtime session; exactly two conversational controls exposed to the model, `admit_conversation` and `stop_listening`, and no desktop tools or execution authority; a client-owned microphone and capture/playback graph, so the hub holds no audio; an inactivity clock refreshed by actual user speech and nothing else; dismissal that closes the session exactly once, leaves phrase wake armed and cancels no unrelated work; re-wake that starts a new conversation; and the lane event vocabulary still exactly `progress`, `answer`, `voice_opened`, `voice_closed`. ADR-0053 supersedes the enrolment-first admission design of [ADR-0005](docs/02-DECISIONS/0005-wake-is-enrolment-first-fingerprinting.md), which stays on disk as the record of what was tried.

**The current work is [M6 — The north star](docs/07-ROADMAP.md).** Stage 1 froze what *"tell me my most recent email"* means — mailbox identity, admissible recency evidence, spoken fields, audit cardinality, and refusal order — in [10-NORTH-STAR-CONTRACT.md](docs/10-NORTH-STAR-CONTRACT.md). Stage 2 supplies the exact operator-owned authority described by [ADR-0054](docs/02-DECISIONS/0054-gmail-authority-is-composed-by-the-operator-unit.md). Stage 3 adds the trusted non-model seam in [ADR-0055](docs/02-DECISIONS/0055-orchestration-requests-launch-the-daemon-decides-it.md): orchestration may request one identity, but only the daemon decides authority and returns the result. The live receipt launched non-personal `yad` and refused unpermitted Gmail without launching a browser. No Gmail launch, inbox traversal, voice request lifecycle, or resolver has shipped. The habit M1 set still holds — **make each gate fail on purpose before trusting it**. A gate that has only ever passed is indistinguishable from one that is not wired up.

**Two findings a newcomer should not have to discover twice.** The daemon is Node, not Python — Linux accessibility is plain D-Bus underneath, and Node matched Python on read, write and events. And an application becomes readable only at the moment it starts, so the assistant opens applications itself and changes nothing about how your system launches them.

---

## The shape, in one screen

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENTS — a face, ears, a mouth. No authority.             │
│  tray widget · phone page · dashboard                       │
└───────────────────────────┬─────────────────────────────────┘
                            │  lanes: progress · answer ·
                            │  voice_opened · voice_closed
┌───────────────────────────▼─────────────────────────────────┐
│  HUB — the brain. Agents, tools, memory, credentials,       │
│  audit, consent. Holds NO audio.                            │
└───────────────────────────┬─────────────────────────────────┘
                            │  one transport package,
                            │  socket keyed on schema digest
┌───────────────────────────▼─────────────────────────────────┐
│  DAEMON — the only process that touches the desktop.        │
│  Node, single-threaded, accessibility tree in and out.      │
└─────────────────────────────────────────────────────────────┘
```

Three rules that fall out of that picture and are enforced by tests, not by good intentions:

- **The hub never holds audio.** Ears and mouth belong to the client that has them. → [ADR-0006](docs/02-DECISIONS/0006-hub-holds-no-audio.md)
- **Pixels are the tier of last resort.** Semantic first, always, and a refusal explains itself. → [ADR-0004](docs/02-DECISIONS/0004-semantic-first-pixels-last.md)
- **The human outranks the agent.** A person reaching for a field the agent is working in takes it, and the change is attributed to them.

---

## Non-negotiables

These are not preferences. Each one is a scar.

- **Machine configuration lives in this repository**, in `infra/`, applied by a checked-in script. Not in a database column. Not in a home directory. → [ADR-0001](docs/02-DECISIONS/0001-machine-config-lives-in-the-repo.md)
- **The protocol freeze is a CI job**, not a comment. The prototype's schema was frozen in its own commit and then changed twenty-two more times. → [ADR-0002](docs/02-DECISIONS/0002-schema-freeze-is-a-ci-job.md)
- **One transport package from the first commit.** The prototype grew a second, drifted daemon client inside the hub and did not notice for a week. → [ADR-0003](docs/02-DECISIONS/0003-one-shared-transport-package.md)
- **Wake is phrase-only; conversation admission is directedness, not identity.** A bounded opening stays provisional until the hub decides it was addressed to Mastra. → [ADR-0053](docs/02-DECISIONS/0053-phrase-wake-gates-a-client-owned-voice-session.md)
- **One vertical slice before any parallel agents.** → [ADR-0015](docs/02-DECISIONS/0015-one-vertical-slice-before-parallel-agents.md)
- **A claim that needs a desktop is proved by an artifact**, produced by a script, committed to the repository. → [ADR-0012](docs/02-DECISIONS/0012-claims-needing-a-desktop-are-proved-by-artifact.md)

---

## What this is not

Not a remote shell. Not a screen-scraper with a voice bolted on. Not an agent holding your passwords. Not something that acts on an irreversible thing without an attestation it did not write itself.

The long version, with the reasoning: [00-PRODUCT.md](docs/00-PRODUCT.md).

---

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) — how to make a change here, what a pull request must carry, and the specific ways the prototype's pull requests went wrong.

## Licence

Apache-2.0, matching the Mastra monorepo this is designed to be dropped into. See [04-INTEGRATION-PLAN.md](docs/04-INTEGRATION-PLAN.md).

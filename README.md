# Mastra CC

A voice-first agent that operates your Linux desktop the way a person does — by asking the desktop what is on it, and acting on the things it names.

You say *"Hey Mastra."* A small face appears in the corner. You say *"tell me my most recent email."* It finds the mail window, reads the top of the list, and tells you. It never took a screenshot to do that, and it never typed anything you did not ask for.

**Status: pre-code.** This repository currently contains the plan. Nothing is implemented yet, by design — the plan comes first this time, and the reason it does is written down in [`docs/03-LESSONS.md`](docs/03-LESSONS.md).

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
| [02-DECISIONS/](docs/02-DECISIONS/README.md) | Sixteen ADRs, each back-filled from prototype evidence |
| [03-LESSONS.md](docs/03-LESSONS.md) | What went wrong, categorised, and the rule each failure buys |
| [04-INTEGRATION-PLAN.md](docs/04-INTEGRATION-PLAN.md) | How this drops into the Mastra monorepo without a rewrite |
| [05-TEST-STRATEGY.md](docs/05-TEST-STRATEGY.md) | Boundary pins, mutation tests, proof artifacts, the live lane |
| [06-OPERATIONS.md](docs/06-OPERATIONS.md) | Running the factory: dispatch, the keeper, board vocabulary, pinned versions |
| [07-ROADMAP.md](docs/07-ROADMAP.md) | Milestones, each with a gate that can fail |
| [08-GLOSSARY.md](docs/08-GLOSSARY.md) | Exact vocabulary. Several prototype bugs were vocabulary bugs |

**If you are a fresh session with fifteen minutes:** read 00, then 01, then the [ADR index](docs/02-DECISIONS/README.md), then [CONTRIBUTING.md](CONTRIBUTING.md). That is enough to make a correct first change.

**If you are about to write code:** you also need [05-TEST-STRATEGY.md](docs/05-TEST-STRATEGY.md) and [07-ROADMAP.md](docs/07-ROADMAP.md), because the roadmap says which milestone you are in and the milestone says which gate must pass.

**Where the work actually starts.** M0 (these documents) closed on 2026-08-08 with all three open decisions taken — they are recorded under [§Decisions taken](docs/07-ROADMAP.md) and you do not need to re-open them. **The next commit belongs to [M1 — Skeleton](docs/07-ROADMAP.md): repository layout, toolchain, and gates, with no features at all.** M1 is not finished when the gates pass; it is finished when each gate has been *made to fail on purpose* and observed going red.

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
│  Python, single-threaded, accessibility tree in and out.    │
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
- **Wake is enrolment-first fingerprinting.** No transcription model in the wake path. The one that was tried heard "He master." → [ADR-0005](docs/02-DECISIONS/0005-wake-is-enrolment-first-fingerprinting.md)
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

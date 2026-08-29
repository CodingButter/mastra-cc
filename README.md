# Mastra CC

A daemon that gives an agent a truthful, actionable model of a live desktop — and a package that knows how to use it.

An agent asks what applications are open, asks a window what is inside it, reads the value of a field, types into it and proves the text arrived, and subscribes to one element so it is *told* when something under it changes. It does that by asking the desktop what things **are** — role, name, state, place in the hierarchy — never by photographing the screen and guessing where to click.

**Mastra CC is a peripheral, not an assistant.** There is no face, no wake word and no voice here. Thinking belongs to an agent runtime; the desk belongs to us. → [ADR-0057](docs/02-DECISIONS/0057-mastra-cc-is-a-peripheral-not-an-assistant.md)

---

## The two artifacts

**The daemon.** The only process that touches the desktop. Node, single-threaded, accessibility tree in and out. It owns desktop truth: what exists right now, what is actionable, what changed and when, which application an element belongs to, and the receipt for every effect it caused. It is built to run wherever the desk is — hardware, VM or container — and its Linux backend is one backend, not the architecture.

**The package.** An installable dependency an agent runtime consumes. It knows the daemon's operations, how to sequence them, and how to recover when a desktop answers something surprising. It versions separately from the daemon on purpose: the daemon is engineering and is done per release, the package is judgment and drifts with the models that read it.

```
┌──────────────────────────────────────────────────────────────┐
│  AGENT RUNTIME (Mastra) — loop, models, memory, skills.      │
│  Thinking. Not this repository.                              │
└───────────────────────────┬──────────────────────────────────┘
                            │  the installable package
┌───────────────────────────▼──────────────────────────────────┐
│  TRANSPORT — one implementation, one socket, keyed on the    │
│  schema digest. Lanes carry progress and answers.            │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│  DAEMON — the only process that touches the desktop.         │
│  Observe · act · attribute · subscribe · refuse.             │
└──────────────────────────────────────────────────────────────┘
```

---

## What it does today

- **Observes semantically.** Resolves *the compose button* to an element with role `push button`, name `Compose`, inside the mail client's window — and reads its ordinary text and numeric content. A platform-protected control returns a structured redaction, never a value. → [ADR-0056](docs/02-DECISIONS/0056-permitted-content-is-observable-protected-content-is-redacted.md)
- **Acts and proves it.** Typing delivers text to a focused element, the daemon verifies the platform read-back internally, and the caller can prove the result by observing the element again afterwards.
- **Attributes change.** Every effect carries who caused it, and a person reaching for a field the agent is working in takes it — the change is attributed to them.
- **Subscribes to a subtree.** Subscribe to one element and get a content-free pointer when it or any descendant changes; content requires a fresh authorised query. That closed loop — act, be told, confirm, act — is the speed feature, not only the safety one.
- **Refuses honestly.** Authority is capability-scoped per application. A refusal names its reason in bytes the caller can act on, and never widens itself as a fallback.
- **Writes receipts.** The audit record is written by the daemon at the point of effect, because nothing above it can be trusted to write an honest one. → [ADR-0026](docs/02-DECISIONS/0026-the-audit-log-is-an-access-record-episodes-are-the-narrative.md)

**Two findings a newcomer should not have to rediscover.** The daemon is Node, not Python — Linux accessibility is plain D-Bus underneath, and Node matched Python on read, write and events. And an application becomes readable only at the moment it starts, so the daemon opens applications itself and changes nothing about how your system launches them.

---

## Non-negotiables

These are not preferences. Each one is a scar.

- **Pixels are the tier of last resort.** Semantic first, always, and a refusal explains itself. → [ADR-0004](docs/02-DECISIONS/0004-semantic-first-pixels-last.md)
- **The protocol freeze is a CI job**, not a comment. The prototype's schema was frozen in its own commit and then changed twenty-two more times. → [ADR-0002](docs/02-DECISIONS/0002-schema-freeze-is-a-ci-job.md)
- **One transport package from the first commit.** The prototype grew a second, drifted daemon client and did not notice for a week. → [ADR-0003](docs/02-DECISIONS/0003-one-shared-transport-package.md)
- **Machine configuration lives in this repository**, in `infra/`, applied by a checked-in script. → [ADR-0001](docs/02-DECISIONS/0001-machine-config-lives-in-the-repo.md)
- **Raw input is the most restricted class**, off by default, never self-granted, never a fallback — and no such class has been built. → [ADR-0046](docs/02-DECISIONS/0046-raw-input-is-the-most-restricted-class-not-a-banned-one.md)
- **A claim that needs a desktop is proved by an artifact**, produced by a script, committed to the repository. → [ADR-0012](docs/02-DECISIONS/0012-claims-needing-a-desktop-are-proved-by-artifact.md)
- **Make each gate fail on purpose before trusting it.** A gate that has only ever passed is indistinguishable from one that is not wired up.

---

## What this is not

Not a voice assistant. Not a remote shell. Not a screen-scraper. Not an agent holding your passwords. Not something that acts on an irreversible thing without an attestation it did not write itself.

The client surface that used to live here — hub, widget, dashboard, voice — was removed on 2026-08-28. A spoken assistant remains possible as a composition *over* this runtime; it is no longer what this repository is about, and the reasoning is in [ADR-0057](docs/02-DECISIONS/0057-mastra-cc-is-a-peripheral-not-an-assistant.md).

The long version: [00-PRODUCT.md](docs/00-PRODUCT.md). Where it goes next: [07-ROADMAP.md](docs/07-ROADMAP.md).

---

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) — how to make a change here, what a pull request must carry, and the specific ways the prototype's pull requests went wrong.

## Licence

Apache-2.0, matching the Mastra monorepo this is designed to be dropped into. See [04-INTEGRATION-PLAN.md](docs/04-INTEGRATION-PLAN.md).

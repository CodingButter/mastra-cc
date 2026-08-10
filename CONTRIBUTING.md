# Contributing

This file is written for two kinds of contributor and does not distinguish between them: a person, and an agent session that woke up thirty seconds ago with no memory of yesterday.

Everything here exists because the prototype did the opposite at least once. Where a rule looks pedantic, the pedantry is the point — the citation next to it is the incident.

---

## 0. Before you touch anything

**Read, in this order:** [README.md](README.md) → [docs/00-PRODUCT.md](docs/00-PRODUCT.md) → [docs/01-ARCHITECTURE.md](docs/01-ARCHITECTURE.md) → the [ADR index](docs/02-DECISIONS/README.md).

**Then find out where you are:** [docs/07-ROADMAP.md](docs/07-ROADMAP.md) names the current milestone and the gate that must pass before it can be called done. If your change does not serve the current milestone, say so out loud in the pull request rather than quietly widening scope.

**Read the vocabulary:** [docs/08-GLOSSARY.md](docs/08-GLOSSARY.md). Terms marked 🔒 are exact strings from enums and wire payloads. The prototype lost hours to a board value that was guessed rather than read, and twelve automated wake-ups to a stage transition that was rejected for the same reason.

---

## 0.5 Setting up

Since M1 there is code to install and gates to run. Node 22 or later and pnpm 10 are the toolchain; versions are pinned by the workspace, not by this document.

```sh
pnpm install
node protocol/generate.mjs          # generated bindings are build output, never committed
pnpm turbo run build lint typecheck test
```

On a fresh checkout, run the generator **before** the first install if install complains about `@mastra-cc/protocol-types` — CI does it in that order for the same reason. The wider gate set (freeze gate, determinism, mutations, boundary pins, licences, docs check) is what CI runs; each is a single `node tools/...` or `node scripts/...` invocation you can run locally, and [tools/pins/README.md](tools/pins/README.md) explains which boundary pins are wired and which are deliberately absent. Machine setup beyond the toolchain lives in `infra/apply.sh`, per §2.

Tests that need a display and a live accessibility bus are gated behind `MASTRA_CC_LIVE=1` and skip loudly otherwise; the default lane must stay green with no desktop at all, because the replay backend answers from recorded fixtures under `daemon/fixtures/`.

---

## 1. Read the source, do not guess the shape

**The rule:** when an interface rejects you, open its parser. Not its documentation, not your memory of it — the code that parses your request.

This is the single highest-value habit in this document. In the prototype, four differently-shaped request bodies were rejected in a row by an endpoint whose validator was on disk the entire time, listing exactly two legal values. Reading it took two minutes. Guessing had already taken hours.

The same rule covers library behaviour. If you cannot cheaply verify a claim by reading, say *"I do not know"* and search — thirty seconds of looking things up beats five turns of confident wrongness.

**Calibrate your language to your evidence.** *"Confirmed by reading the parser at file:line"* and *"I believe"* are different claims. Never let the second wear the clothes of the first.

---

## 2. Configuration lives in the repository

If a change requires a machine to be set up a particular way, **the setup goes in `infra/`, applied by a checked-in script.**

Forbidden, all three learned the hard way:

- Configuration in a database column. The prototype's sandbox provisioning command lived in one. A directory rename broke every new environment while every running one kept working — the system looked healthy and could not grow.
- An operational script in a home directory. A queue keeper was fixed, tested, and merged, and the fix never ran, because production ran an older copy from `~/bin`.
- A limit or flag in a service unit and nowhere else. The memory ceiling that stopped nightly crashes lived only in systemd.

**The test:** could a fresh machine reach a working state by cloning this repository and running one script? If not, the missing part is a bug, no matter how well the code works. → [ADR-0001](docs/02-DECISIONS/0001-machine-config-lives-in-the-repo.md)

**Corollary for renames.** Before merging any change that moves or renames a top-level directory, grep the out-of-tree configuration too — CI definitions, provisioning commands, deploy scripts, service units. Then prove it by provisioning one genuinely fresh environment. A rename that passes CI can still have broken every future machine.

---

## 3. One truth, one place

Do not copy a module to make it available somewhere else. If two runtimes need the same logic, it becomes a package that both depend on.

The prototype ended with the same live-audio modules in three locations, held together by byte-for-byte parity tests. The parity tests worked — they caught a hand-edit of a generated copy the same day it happened. **The need for a parity test is a signal that a duplication exists**, and the correct response is to remove the duplication, not to celebrate the test.

Generated files are build output. They are regenerated by their generator, never hand-edited, and the generator's idempotency is itself a test. → [ADR-0003](docs/02-DECISIONS/0003-one-shared-transport-package.md), [ADR-0009](docs/02-DECISIONS/0009-generated-code-is-build-output.md)

---

## 4. Changing the protocol

`protocol/schema.json` is frozen, and the freeze is a CI job that fails your build. It is not a comment. The prototype's schema was frozen in its own commit on day one and then changed twenty-two more times, the last on day four.

A schema change must arrive with:

1. an ADR in `docs/02-DECISIONS/` explaining why the contract must move,
2. a version bump,
3. regenerated bindings for **every** language target, produced by the generator,
4. updated golden fixtures,
5. a compatibility note: what an older client does when it meets a newer service.

The daemon socket is keyed on the schema digest, so a mismatched client cannot connect by accident. That is a safety net, not a licence. → [ADR-0002](docs/02-DECISIONS/0002-schema-freeze-is-a-ci-job.md)

---

## 5. Tests

Full reasoning in [docs/05-TEST-STRATEGY.md](docs/05-TEST-STRATEGY.md). The short version:

- **Boundary pins** assert architectural rules against source text. Every one must assert its own file list is non-empty — a pin that globs zero files passes forever and guards nothing. Pins must strip comments before matching, and must check the package manifest as well as the source. The prototype banned a transcription library in every shipped file while the dependency stayed declared in the manifest for days.
- **Mutation tests** break a guarantee on purpose and require the suite to go red. The mutation must assert that it applied before running the suite.
- **Golden fixtures** freeze wire behaviour.
- **Live-lane tests** need a display and an accessibility bus. The default lane runs everywhere and must stay runnable, because the accessibility layer can abort the interpreter when its bus is absent — a crash, not a failure, and it takes the whole suite with it.

**A green suite is not a green build.** Run the build too. Two clean merges once produced a red main because each was individually green.

---

## 6. Claims that need a desktop

If a claim can only be proved on a real desktop — that a keystroke reached a field, that a deletion is reported as a deletion, that a window sits above another window — it is proved by **a script that produces a committed artifact.**

The script edits nothing it does not have to. It refuses to write a partial artifact. Estimated numbers are not proof, and a proof that cannot prove writes nothing. Issues in this class carry the `needs:desktop` label and wait for a machine with a screen; they do not get downgraded into an assertion in prose. → [ADR-0012](docs/02-DECISIONS/0012-claims-needing-a-desktop-are-proved-by-artifact.md)

---

## 7. Pull requests

**Rebase immediately before opening.** A pull request that was mergeable an hour ago is a claim, not a fact — main moves, and a rename landing under you turns a clean branch into a pile of conflicts.

**A pull request must carry:**

- what changed and, more importantly, **why** — the condition that made the change necessary;
- the gate output that proves it: the test run, the typecheck, the build;
- for anything touching a boundary, the boundary pin or mutation test that now guards it;
- for anything requiring a desktop, the artifact.

**Title and description are written for someone who knows nothing about the work.** Describe the whole unit being shipped. Do not narrate the detours taken along the way; a fix required mid-branch is not a feature of the branch.

**Merging does not advance the board.** Move the card yourself, in the same breath as the merge, using the exact enum values in [docs/06-OPERATIONS.md](docs/06-OPERATIONS.md). Phantom cards for shipped work cause automated systems to re-wake finished runs, and the prototype burned a night of capacity on exactly that.

---

## 8. When you are wrong

Say so immediately, without ceremony, and state the corrected framing in one line. The prototype's stall was misdiagnosed twice in twenty minutes; both retractions were worth more than either original claim, and the second diagnosis was only reachable because the first was abandoned quickly.

Two specific anti-patterns, both observed:

- **Confidence without a receipt.** *"The keeper is fixed"* was true of the code and false of production for six hours.
- **Reading counts instead of words.** Agents were judged stalled by message counts when their last sentences said, correctly, that there was nothing left to do. Read the last actual sentence.

---

## 9. Style

Follow the surrounding code. Where there is no surrounding code, follow the Mastra monorepo house style described in [docs/04-INTEGRATION-PLAN.md](docs/04-INTEGRATION-PLAN.md) — this package is meant to drop into it without a rewrite.

- Write the comment that explains *why*, especially where the reason is a guarantee that a future reader would otherwise cheerfully remove. The prototype's window code carries a long comment about never stealing typing focus, and that comment is load-bearing.
- Delete dead code completely. No compatibility shims, no renaming to `_unused`, no tombstone comments.
- Do not add error handling for conditions that cannot occur. Validate at boundaries: user input, external APIs, the desktop.

---

## 10. Commits

Explain why, not just what. Match the existing style — the prototype's best commit subjects read as sentences about behaviour, and they are the reason its history could be mined at all.

Agent-authored commits include:

```
Co-Authored-By: Mastra Code <noreply@mastra.ai>
```

Never commit a file likely to hold a secret. A token in a log file is a token.

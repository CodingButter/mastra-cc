# Architecture Decision Records

Read them before writing code. They are the reason the layout in [01-ARCHITECTURE.md](../01-ARCHITECTURE.md) looks the way it does.

Two kinds of record live here, and the difference matters when you are deciding how much to trust one:

- **0001–0016 are back-filled from evidence** in the `computer-controls` prototype: 332 commits, 127 pull requests, and 105 issues over seven days (2026-08-01 → 2026-08-08). None of them are speculative. Each names the commit, PR, issue, or measurement that produced it.
- **0027–0032 are findings-forced**, written 2026-08-09 at the close of M0.5. Each names the measurement that forced it and links the artifact in [docs/proofs/](../proofs/). Six earlier records were superseded by them — 0020 entirely, and 0008, 0010, 0019, 0021 and 0023 in part. None were edited: each carries a header note saying which part died and why, because the reason a decision was made is as useful as the decision, especially when the premise turns out to be wrong.
- **0017–0026 are forward decisions**, taken 2026-08-08 while scoping the rebuild. They are argued from prototype evidence and from source read in a live checkout, but several rest on beliefs that have not been probed yet. Where that is true the record says so, and the belief is filed as a question in [09-QUESTIONS.md](../09-QUESTIONS.md). A forward decision that a spike contradicts gets superseded, not quietly edited.

## The records

| # | Decision | One-line reason |
|---|---|---|
| [0001](0001-machine-config-lives-in-the-repo.md) | Machine configuration lives in the repository | Three outages came from config no test could see |
| [0002](0002-schema-freeze-is-a-ci-job.md) | The protocol freeze is a CI job, not a comment | The prototype's freeze was prose; the file changed 23 times |
| [0003](0003-one-shared-transport-package.md) | One shared transport package, from commit one | A second, drifted daemon client had skipped the digest check |
| [0004](0004-semantic-first-pixels-last.md) | Semantic first; pixels last, addressed by window | The founding bet; it held for seven days across four toolkits |
| [0005](0005-wake-is-enrolment-first-fingerprinting.md) | Wake is enrolment-first fingerprinting | The recogniser heard "hey mastra" as "He master." |
| [0006](0006-hub-holds-no-audio.md) | The hub holds no audio | Privacy, latency, and topology all point the same way |
| [0007](0007-identity-is-derived-credentials-are-minted.md) | Identity is derived; credentials are minted | "Never give the key to the agent or they'll try it on every door" |
| [0008](0008-scopes-operation-classes-and-honest-refusals.md) | Scopes, operation classes, honest refusals | A refusal blamed a flag that was demonstrably present |
| [0009](0009-generated-code-is-build-output.md) | Generated code is build output, not source | Three generated files churned in lockstep with the schema |
| [0010](0010-daemon-is-python-single-threaded-default-glib-context.md) | Daemon: Python, one thread, default GLib context | The wrong main context loses events silently |
| [0011](0011-dashboard-is-vite-with-playground-ui.md) | Dashboard is Vite + playground UI from commit one | The migration became a gate on unrelated work |
| [0012](0012-claims-needing-a-desktop-are-proved-by-artifact.md) | Desktop claims are proved by artifact | A proof that cannot prove must write nothing |
| [0013](0013-episodes-are-a-git-graph.md) | Episodes are a git graph | Inspectable with tools people already have |
| [0014](0014-monorepo-droppable-from-commit-one.md) | Monorepo-droppable from commit one | The day-seven reshape cost 179 files and one outage |
| [0015](0015-one-vertical-slice-before-parallel-agents.md) | One vertical slice before parallel agents | Rework was the constraint, never throughput |
| [0016](0016-the-face-is-a-managed-window-that-hides-when-told.md) | The face is a managed window that hides when told | Unfocusable on X11 means unmanaged, and "on top" silently stops working |
| [0017](0017-platform-backends-live-inside-the-daemon.md) | Platform backends live inside the daemon | Hub and clients must not learn which operating system they are on |
| [0018](0018-the-protocol-speaks-a-neutral-element-vocabulary.md) | The protocol speaks a neutral element vocabulary | A platform's words in the schema become a version bump later |
| [0019](0019-capability-is-not-authority.md) | Capability is not authority | The operating system's permission is a precondition, never consent |
| [0020](0020-granting-an-application-is-a-transaction-with-a-rollback.md) | Granting an application is a transaction with a rollback | Runtime edits to launcher entries are facts no test in the tree can see |
| [0021](0021-standing-authority-is-armable-attestation-is-not-waivable.md) | Standing authority is armable; attestation is not waivable | Prompting for every write is how assistants become babysitting |
| [0022](0022-failure-to-act-is-harm-we-caused.md) | Failure to act is harm we caused | Every protection must fail toward informing, not toward stopping quietly |
| [0023](0023-the-phone-is-a-consent-surface.md) | The phone is a consent surface | The decision travels with the person; the authority never leaves the hub |
| [0024](0024-a-task-in-flight-can-be-steered.md) | A task in flight can be steered | Stop and start are not the only two things a person may want to say |
| [0025](0025-the-agent-fleet-only-fixes-defined-behaviour.md) | The agent fleet only fixes defined behaviour | If there is no intended behaviour yet, the fleet does not get to invent it |
| [0026](0026-the-audit-log-is-an-access-record-episodes-are-the-narrative.md) | The audit log is an access record; episodes are the narrative | A receipt you can rewrite is not a receipt |
| [0027](0027-the-assistant-opens-the-application-itself.md) | The assistant opens the application itself | Readability is decided at launch, so there is nothing on your system to rewrite |
| [0028](0028-trust-is-a-mode-and-the-default-asks-almost-nothing.md) | Trust is a mode, and the default asks almost nothing | People want to hand over a task and leave; the record survives every mode |
| [0029](0029-the-daemon-knows-what-it-launched.md) | The daemon knows what it launched | It can only ever disclaim its own, never claim yours |
| [0030](0030-the-daemon-is-one-node-process.md) | The daemon is one Node process; Linux does not need Python | Accessibility is plain D-Bus underneath; the binding was a convenience, not a gate |
| [0031](0031-the-agent-emits-a-plan-a-model-free-interpreter-runs-it.md) | The agent emits a plan; a model-free interpreter runs it | A transcript cannot be reviewed, replayed, or measured |
| [0032](0032-the-page-layer-is-an-instrument-not-a-gate.md) | The page layer is an instrument, not a gate | Five of eight paths observed — a gate with holes is worse than none |
| [0033](0033-the-schema-arrives-at-one-point-oh.md) | The schema arrives at 1.0.0, and its introduction goes through its own gate | A gate whose first act is an exemption has taught everyone how to ask for the second one |
| [0034](0034-launch-is-the-first-effect-class-operation.md) | Launch is the first effect-class operation, and B11 arrives with it | Authority before capability, one byte-identical refusal, and the timing pin lands in the same commit as the operation it pins |
| [0035](0035-the-browser-is-read-through-its-own-protocol.md) | The browser is read through its own protocol, over a hand-rolled channel | One recordable exchange seam over the debugging endpoint - discovery included - so the offline lane replays a real browser; Playwright rejected for hiding the wire |
| [0036](0036-grants-live-in-a-file-the-daemon-owns.md) | Grants live in a file the daemon owns | Deny-by-default observe visibility from a daemon-local permissions file ∪ session flags ∪ launch permits, enforced inside the walk so an ungranted subtree is never read; the one permitted read is the name |
| [0037](0037-the-other-three-classes-are-on-the-wire-before-they-are-possible.md) | The other three classes are on the wire before they are possible | schema version 1.2.0 defines editElement/activateElement/submitElement as refused-by-name methods that never touch a backend; attestation required in the contract from day one; classes live in the B11-pinned dispatch table, not the schema |
| [0038](0038-a-browser-profile-is-a-launch-identity.md) | A browser profile is a launch identity | Named browser profiles are catalog keys composed at boot from an operator file, not a schema parameter; observe names expand through the recipe's appears-as tree name while launch authority never does; the daemon never looks inside a profile directory |

## Writing a new one

Use the next free number. Keep the four sections: **Context**, **Decision**, **Consequences**, **Evidence**.

Two rules, both of which the documents above try to honour:

1. **Every claim carries a receipt.** A commit hash, a PR or issue number, a `file:line`, or a measurement with the command that produced it. A claim without one is a belief, and beliefs are what this whole exercise is trying to replace.
2. **State the cost.** A decision with no listed downside has not been thought about. If the Consequences section only contains good news, the record is not finished.

Superseding an ADR means writing a new one that says so in its header and updating the old one's status. Do not edit a decision's history — the reason it was made is as useful as the decision, especially when it turns out to be wrong.

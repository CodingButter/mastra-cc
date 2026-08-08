# Architecture Decision Records

Every ADR here is **back-filled from evidence** in the `computer-controls` prototype: 332 commits, 127 pull requests, and 105 issues over seven days (2026-08-01 → 2026-08-08). None of them are speculative. Each one names the commit, PR, issue, or measurement that produced it.

Read them before writing code. They are the reason the layout in [01-ARCHITECTURE.md](../01-ARCHITECTURE.md) looks the way it does.

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

## Writing a new one

Use the next free number. Keep the four sections: **Context**, **Decision**, **Consequences**, **Evidence**.

Two rules, both of which the documents above try to honour:

1. **Every claim carries a receipt.** A commit hash, a PR or issue number, a `file:line`, or a measurement with the command that produced it. A claim without one is a belief, and beliefs are what this whole exercise is trying to replace.
2. **State the cost.** A decision with no listed downside has not been thought about. If the Consequences section only contains good news, the record is not finished.

Superseding an ADR means writing a new one that says so in its header and updating the old one's status. Do not edit a decision's history — the reason it was made is as useful as the decision, especially when it turns out to be wrong.

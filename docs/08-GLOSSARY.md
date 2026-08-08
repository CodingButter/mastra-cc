# 08 — Glossary

**Why this document is normative:** several prototype bugs were vocabulary bugs. A board value was guessed instead of read. A queue state named `sent` was understood as *finished* when it meant *delivered*. Lane event names were paraphrased in one place and not another.

**Terms marked 🔒 are exact strings.** They appear in code, in wire payloads, or in an API enum. Do not paraphrase them, do not translate them into prose synonyms, and do not invent a fifth member of a four-member set.

---

## Product

**Mastra CC** — this system. The tray face, the hub, and the daemon together.

**North star sentence** — *"Tell me my most recent email."* The acceptance test for the whole product. → [00-PRODUCT.md §2](00-PRODUCT.md)

**Semantic desktop control** — driving applications through the accessibility tree, by role and name, rather than by pixels or coordinates. → [ADR-0004](02-DECISIONS/0004-semantic-first-pixels-last.md)

**Three layers** — daemon, hub, clients. **Three depths** — how far into an application the system may reach, which is a consent question. **One deb** — the shipping unit.

---

## Processes

**Daemon** — the process that speaks to the accessibility layer. The only one that may. Python. → [ADR-0010](02-DECISIONS/0010-daemon-is-python-single-threaded-default-glib-context.md)

**Hub** — the brain. Agents, tools, memory, credentials, audit, lane control. Holds **no audio**. → [ADR-0006](02-DECISIONS/0006-hub-holds-no-audio.md)

**Client** — anything with a face or ears. The widget, the phone page, the dashboard. Holds no authority and no long-lived credential.

**Widget** — the resident Electron tray client on the desktop. Also called **the face** or **the orb**.

**Ears** — a client's microphone capture chain. **Mouth** — a client's voice output and its dial to the provider. A client may have both; they are separate concerns and separate boundaries.

---

## Desktop model

**Accessibility tree** — the structured description of windows and controls that the desktop exposes; the same one a screen reader consumes.

**Element** — one node in that tree. Has a role, a name, a state, and a place in a hierarchy.

**Delta** — a change in the tree since a given point, retrieved by the change-query primitive rather than by comparing two full reads.

**Attribution** — who caused a change: `self`, `external`, or `unattributed` (see Consent below). This is what makes *the human outranks the agent* enforceable rather than aspirational.

**Ownership** — an element is *owned while it is being written*. A human reaching for a field the agent is working in takes it.

**Curing** — making an application's accessibility exposure readable when it is not by default. The prototype cured Chromium with desktop-entry overrides and a renderer flag, and explicitly rejected requiring a screen reader to be running.

---

## Consent

🔒 **Operation classes — exactly five, in this order of consequence.** A *grant* is a subset of these; "scope" in prose means "the operation classes plus the applications and anchors a grant covers".

| Class | Covers |
|---|---|
| `observe` | reading the tree, values, states. Changes nothing |
| `edit` | changing a value in place, such as typing into a field |
| `activate` | moving focus, raising a window. Visible, trivially reversible |
| `submit` | triggering an application's own action — send, post, purchase |
| `destructive` | may discard or overwrite user data, or is not reversible |

🔒 **Attribution — exactly three:** `self` (the agent did this), `external` (something outside the agent's causal scope did this — *this is news*), `unattributed` (undecidable, and **deliberately not guessed**).

**Attestation** — the service's own description of a `submit`-class action, produced before it happens. The agent cannot author it. A commit the service cannot describe is refused with 🔒 `ATTESTATION_FAILED`.

**Depth ceiling** — how far a walk may descend. Must be justified by measured behaviour, never by an instrument setting. → [ADR-0008](02-DECISIONS/0008-scopes-operation-classes-and-honest-refusals.md)

**Deny by default** — an application the user has not permitted is **invisible**, not blocked. A blocked-but-visible application leaks that it is installed.

**Emergency stop** — a protocol method that halts agent action. Not advisory.

**Minted token** — a short-lived credential issued by the hub for one purpose. The opposite of a **grant key**, which was an early design in which the agent presented a key to widen its own scope, and which was deleted. → [ADR-0007](02-DECISIONS/0007-identity-is-derived-credentials-are-minted.md)

---

## Lanes

🔒 **Lane events — exactly four. Do not paraphrase.**

| Event | Meaning |
|---|---|
| `progress` | the agent is working; here is what it is doing |
| `answer` | the agent has something to say to the person |
| `voice_opened` | a voice session became active somewhere |
| `voice_closed` | the last voice session ended |

**Edge, not state** — `voice_opened` and `voice_closed` fire at first-open and last-close. A client that joins afterwards is told the current state explicitly, because it can never learn it from an edge it missed.

**Turn** — one exchange: the person speaks, the system acts, the system answers. Ends on silence or on a decline.

**Dismissal** — a gesture that hides the face. Comes from a tray click or from a spoken *no*. Same code path for both. **Does not** cancel work in progress and **does not** disarm the wake word. → [ADR-0016](02-DECISIONS/0016-the-face-is-a-managed-window-that-hides-when-told.md)

---

## Wake

**Wake phrase** — the spoken phrase that opens a turn.

**Fingerprint** — a shape derived from audio, used for matching. Explicitly not a transcript.

**Template** — one stored fingerprint. **Bank** — the set being matched against.

**Factory bank** — the shipped default templates. Gets a person to the enrolment page; does not carry the product. Admits only about a third of true takes at zero false accepts.

**Enrolment** — a person recording the phrase several times to create their own templates. **This is what makes wake work.**

**Threshold** — the distance below which a match opens the gate. **Enrolled weight** — the multiplier favouring a person's own templates over the factory bank.

**Window-invariant** — the property that a fingerprint depends on the phrase, not on the recording window it happened to land in.

**Deaf** — the state of a detector with no templates. The **closed** direction, and the correct failure mode: a detector that cannot load its bank must never open.

→ [ADR-0005](02-DECISIONS/0005-wake-is-enrolment-first-fingerprinting.md)

---

## Testing

**Boundary pin** — a source-level test asserting an architectural rule. Must assert its own file list is non-empty, must strip comments, and must check the manifest as well as the source.

**Mutation test** — breaking a guarantee on purpose and requiring tests to go red. The mutation must assert it applied before the suite runs.

**Golden fixture** — a frozen request/response pair capturing the wire contract's behaviour.

**Parity test** — a byte-for-byte check between two copies of the same code. **The need for one is a signal that a duplication exists**; the fix is to remove the duplication.

**Proof artifact** — a committed markdown file produced by a script that ran against a live desktop. A proof that cannot prove writes nothing.

**Live lane** — tests requiring a display and an accessibility bus. 🔒 `--no-live` is the lane that runs everywhere, and it exists because the accessibility layer can *abort the interpreter* when the bus is absent.

→ [05-TEST-STRATEGY.md](05-TEST-STRATEGY.md)

---

## Factory operations

🔒 **Boards — exactly two:** `work`, `review`. Any other value is rejected, and the rejection does not say which field was wrong.

🔒 **Stages — exactly seven:** `intake`, `triage`, `planning`, `execute`, `review`, `done`, `canceled`.

**Work item** — a card. **Binding** — the link between a work item and a run. **Kickoff** — a delivered instruction to start or resume a run.

🔒 **Queue states:** `sent` means **delivered**, not done. `leased` means picked up. `failed` means the delivery attempts were exhausted; those rows do not auto-retry.

**Keeper** — the periodic job that re-wakes genuinely stalled work. **Requeue** — what it does when it decides a row is stalled. **Refusal** — what it does otherwise, and refusals are the common case.

**Fail open** — resolving an unknown to *unknown* rather than to a judgement. Both the unknown-role and failed-lookup gates do this deliberately: gating on ignorance is refused.

**Phantom card** — a board card for work that has already shipped. The board does not advance itself when a pull request merges.

→ [06-OPERATIONS.md](06-OPERATIONS.md)

---

## Repository

**`infra/`** — every machine-side fact, in the repository, applied by a checked-in script. If it is not here, it does not exist. → [ADR-0001](02-DECISIONS/0001-machine-config-lives-in-the-repo.md)

**Transport package** — the single implementation of the daemon wire protocol. Node builtins only. → [ADR-0003](02-DECISIONS/0003-one-shared-transport-package.md)

**Schema digest** — the hash of `protocol/schema.json`, which keys the daemon socket so a client built against a different version cannot connect by accident.

**Freeze gate** — the CI job that fails on a schema change lacking an ADR, a version bump, and updated fixtures. The freeze is this job. It is not a comment. → [ADR-0002](02-DECISIONS/0002-schema-freeze-is-a-ci-job.md)

**Episode** — a session's history, stored as a git commit graph. → [ADR-0013](02-DECISIONS/0013-episodes-are-a-git-graph.md)

---

## Phrases that carry meaning

Shorthand used across these documents. Each compresses a specific incident.

| Phrase | Means |
|---|---|
| *"Never give the key to the agent or they'll try it on every door."* | Jamie's ruling on credentials, quoted verbatim from the prototype roadmap |
| *"Shape, not a transcript."* | the wake decision contains no words |
| *"A detector with no templates is deaf."* | the closed direction is the safe direction |
| *"A token in a log file is a token."* | never log a mint response |
| *"A PR mergeable an hour ago is a claim, not a fact."* | rebase before opening |
| *"A green suite is not a green build."* | the build is a separate gate |
| *"Habit, not a rule."* | an unenforced convention, which is to say not a rule |
| *"A proof that cannot prove writes nothing."* | no partial artifacts, no estimated numbers |
| *"The human was a typo."* | twelve kickoffs blamed on a person, caused by a wrong enum string |
| *"Sent is not done."* | delivery is not completion |
| *"The fleet looked healthy and could not grow."* | running workers mask broken provisioning |
| *"Rework was the constraint."* | 332 commits in a week; throughput was never the problem |

# 00 — Product

**Status:** normative. Everything else in this repo is downstream of this document.
**Evidence base:** the `computer-controls` prototype, 332 commits over seven days (2026-08-01 → 2026-08-08), 127 pull requests, 105 issues. Every factual claim below carries a receipt: a commit hash, a PR/issue number, or a `file:line` in that prototype.

---

## 1. The one sentence

**Mastra CC lets a person talk to their own computer and have it act on their behalf, at the level of meaning rather than the level of pixels.**

The user says *"tell me my most recent email."* The machine finds the mail application the way a person would — by what things *are*, not where they happen to sit on screen — reads the message, and says it out loud. No screenshot fed to a vision model. No synthetic mouse path. No shell command guessed at from a screengrab.

## 2. The north star

> **"Tell me my most recent email."**

This sentence has been the acceptance test for the whole system since the first week, and it stays. It is a good north star because it is small enough to demo and large enough to require nearly everything:

| The sentence demands | Which forces |
|---|---|
| the machine to hear you across the room | wake detection running locally, on-device |
| the machine to know it may act | a consent and scope model, not a blanket grant |
| the machine to find "mail" | a semantic model of the desktop, not coordinates |
| the machine to read a message | structured reads through the accessibility layer |
| the machine to answer aloud | a voice lane, with the audio staying near the person |
| you to trust the answer | an audit trail of what was answered and why |

What that sentence means precisely — the mailbox, the ordering evidence, the minimum spoken fields, the honest refusals, and the audit — is frozen in [10-NORTH-STAR-CONTRACT.md](10-NORTH-STAR-CONTRACT.md).

If a change does not move that sentence closer to working reliably on a stranger's machine, it is not a priority. In the prototype this discipline slipped: seven days produced an orb with volumetric smoke and a glowing reflection (`08-04`, four consecutive visual commits in one night — see [03-LESSONS.md §3](03-LESSONS.md)) before the north star sentence worked end to end.

## 3. What "semantic desktop control" means

The desktop exposes an accessibility tree — the same structure a screen reader uses. Every window, button, text field, and list item is an object with a role, a name, a state, and a place in a hierarchy. Mastra CC reads and acts on **that**.

**Concretely, the system:**

- resolves *"the compose button"* to an element with role `push button`, name `Compose`, inside the window whose application is the mail client
- reads a text field's value by asking the element for its value
- types by delivering text to a focused element, and can prove afterwards that the text arrived
- reports what changed after an action, attributed to whoever caused it

**Concretely, the system does not:**

- take a screenshot and ask a model where to click
- synthesise raw input events at the X11 or `uinput` layer
- run shell commands on the user's behalf as a substitute for interacting with an app

The prototype banned `xdotool`, `wmctrl`, and `uinput` outright and never lifted the ban. This repository carried that ban until 2026-08-17, when [ADR-0046](02-DECISIONS/0046-raw-input-is-the-most-restricted-class-not-a-banned-one.md) replaced it with containment: raw input is the most restricted operation class, off by default, never self-granted and never reachable as a fallback — and no such class has been built yet. Pixels exist as a **tier of last resort, addressed by window** (`08-01 12:22`, "pixels as the tier of last resort, addressed by window") — a photograph is something you take *of a named window you already resolved semantically*, not a way to find things.

### Why this is the interesting bet

A vision-model-driven clicker is easy to demo and structurally fragile: it re-derives the same UI from pixels on every turn, it cannot tell an enabled button from a disabled one that looks similar, it cannot attribute a change to a cause, and it has no idea whether it just clicked *Send* or *Save Draft*. A semantic driver knows the difference because it asked.

There is also a physical argument the prototype's own pitch material made (`08-04`, "the row where the architectures diverge by physics: who gets the desk"): a remote vision agent needs a machine to look at. A semantic agent runs on the desk that is already there, next to the person, with their session, their credentials, and their applications already open.

## 4. Who it is for

**Primary:** a person at their own Linux desktop who wants a hands-free, spoken assistant with real reach into their applications — not a chatbot in a browser tab.

**Secondary, and load-bearing for the architecture:** *many clients, one brain.* The prototype's architecture note calls this out as a first-class requirement, not a stretch goal ("one server, many clients" — prototype `docs/02-architecture.md`). A phone on the couch, a tray widget on the desk, and a browser tab all talk to the same hub; the hub holds the state and the credentials.

**Not the target:** headless CI automation, screen-scraping bots, or anything whose value proposition is operating a machine nobody is sitting at. The consent model assumes a human is present and reachable.

## 5. The product shape

Three layers, and the user only ever installs one thing.

| Layer | What it is | Where it runs |
|---|---|---|
| **Daemon** | speaks the accessibility layer, owns all desktop reads and writes, enforces scope | on the desktop, per user session |
| **Hub** | the brain: agents, tools, memory, credentials, audit, the voice lane's control plane | one per person, typically the same machine, reachable by their other devices |
| **Clients** | the tray face, the phone page, the dashboard | anywhere that can reach the hub |

The prototype's shipping story was **"one deb, three layers, three depths"** (`08-04` pitch commits) and that holds: a single Debian package installs the daemon and the hub; clients attach.

**Three depths** refers to how far the system is allowed to reach, which is a consent question, not a capability question — see §7.

## 6. What the product refuses to be

These are non-goals with teeth. Each one was a live temptation during the prototype and each one has an issue, a commit, or a ban behind it.

1. **Not a remote shell.** The agent never gets arbitrary command execution as a desktop-control primitive. The prototype's minted-token tool surface was deliberately read-only — `READ_FILE`, `LIST_FILES`, `FILE_STAT`, `GREP` — and adding a launch capability was a *separate, tracked, still-open decision* (issue #183), not something that leaked in.
2. **Not a screen recorder.** Screen capture is off by design at the client. The widget's capability report says `screenCapture: false` and its permission list is exactly one entry, `["media"]` — the microphone, for its own page (prototype `clients/widget/src/boundaries.test.ts`, `GRANTED_PERMISSIONS`).
3. **Not a keylogger.** Watching a field the user is typing in is a *feature with an owner and an expiry*, not ambient logging. The prototype ruled that a human at the keyboard outranks the agent (issue #25) and that an element is *owned while it is being written*.
4. **Not a cloud microphone.** Phrase wake runs on the device. After wake, the client dials one constrained realtime session with a short-lived token and sends one bounded opening directly to it. The hub receives no provisional or realtime audio; tools and memory receive none before admission. See [ADR-0053](02-DECISIONS/0053-phrase-wake-gates-a-client-owned-voice-session.md).
5. **Not a general RPA platform.** No record-and-replay macros, no coordinate scripts. If the accessibility layer cannot describe it, the honest answer is that we cannot do it — and the prototype's security doc has a whole section titled "What this model does NOT guarantee" for exactly this reason.
6. **Not a thing that pretends.** When a browser's accessibility layer is unreadable, the system reports the browser as *running but unreadable*, not as *absent* (`6657915`, `08-04 10:31`). A refusal must explain itself from a check that actually ran (issue #194).

## 7. Consent, in product terms

Consent is a product feature here, not a compliance checkbox, because the thing being asked for — *read and drive my open applications* — is genuinely large.

**Scopes.** Four are the everyday vocabulary: `observe`, `edit`, `activate`, `submit`. They are ordered by consequence, not by convenience. `submit` — the class that sends the email, spends the money, posts the comment — is the one that requires an attestation the agent cannot author itself: the service refuses a commit it cannot describe (`ATTESTATION_FAILED`, protocol method `attestElement`/`commitElement`). A fifth class, `destructive`, is reasoned about above `submit` and is left out of this list because it is never something a person grants casually — and it is absent from the wire for the same reason: it defines no methods, so `protocol/schema.json` does not name it at all, and an attempt at one is refused as an unknown method rather than weighed against a grant. [ADR-0008](02-DECISIONS/0008-scopes-operation-classes-and-honest-refusals.md) and [ADR-0037](02-DECISIONS/0037-the-other-three-classes-are-on-the-wire-before-they-are-possible.md) are normative on the full set. (Corrected 2026-08-21: this said the class "exists in the protocol" and pointed at the schema as normative on it.)

**Granting, and what a grant does not give away.** The permissions surface offers **View** and **Interact** per application: View grants `observe`, Interact grants `edit` and `activate`. Neither grants `submit`. Submit is either asked for at the moment it is needed, or armed deliberately, per application, by a person who was told plainly what they were arming — see [ADR-0021](02-DECISIONS/0021-standing-authority-is-armable-attestation-is-not-waivable.md). Arming removes the interruption. It never removes the attestation, because the attestation is the machine checking itself rather than the person being asked again.

**Permission is the user's, not the operating system's.** An operating system that allows accessibility access has granted a *capability*. It has not granted consent, and it cannot: consent is the user's to give, application by application. Authority is checked first, so that "you did not permit this" can never be mistaken for "your system cannot do this" ([ADR-0019](02-DECISIONS/0019-capability-is-not-authority.md)).

**Depth.** Reach is earned, not assumed. The prototype shipped a depth ceiling, then retracted its own justification when it found the ceiling had been derived from an instrument setting rather than from measured behaviour (issue #42, "name the real one — our depth ceiling"), then re-derived it as *deeper walks are earned* (issues #45, #58, #60). Keep the corrected version: a deeper read is a thing the system asks for with a reason.

**Applications.** Deny by default — and the denial is *named*, not hidden. The user's applications are listed whether or not they have been permitted, each with the capabilities that are enabled, the ones that are refused, and the setting that would change the answer. What stays behind the grant is everything *inside* an application: its windows, its elements, their names and their values. Existence is readable; content is not. See [ADR-0042](02-DECISIONS/0042-existence-is-readable-content-is-not.md).

> **This reverses the earlier rule, and the reason is worth keeping.** Until 2026-08-16 an unpermitted application was *invisible* — it did not appear as blocked, it did not appear at all (proven on real hardware in M2.5: [an unpermitted application is invisible](proofs/an-unpermitted-application-is-invisible.md), which remains the record of the behaviour M2 shipped). The argument was that a visible-but-blocked app leaks what is installed. What it actually produced was worse than a leak: a *false belief*. An agent asked to open an application it cannot see concludes the software is not installed and tells the user to install what they already have — an errand, generated by us, that makes the assistant look broken. Hiding the fence was only ever justified if we did not trust the fence. We do: effect-class operations are refused before the call, under a pinned test (B11), so a capability the agent can read is a capability the daemon actually enforces.

The same rule now covers the assistant's own tools, which were always an exception to the old one. A tool the user has not enabled is refused and *named*, with what it would need — because a refusal that cannot explain itself is indistinguishable from a bug, and because a hidden capability cannot be asked for. Neither the assistant nor the user's software gets concealed: "I could do that, if you let me" is a sentence the system must always be able to say.

**Failure to act is also harm, and it is harm we caused.** Every protective mechanism must fail toward informing the user, not toward stopping quietly. When uncertain, complete the stated task and be loud about it. A person who came home to a job undone, and no warning that it had stopped, was not protected by our caution — they were failed by it. Being unreachable is not permission to stop; being unreachable is itself something to report. See [ADR-0022](02-DECISIONS/0022-failure-to-act-is-harm-we-caused.md), and note the consequence: the notification path is a safety mechanism, not a convenience feature.

**The person wins.** If the user reaches for a field the agent is working in, the agent yields (issue #25, issue #4). There is an emergency stop in the protocol (`emergencyStop`) and it is not advisory.

**Identity is given, not claimed.** A client does not tell the hub who it is; the hub derives it (`08-02 03:02`, merged as PR #1/#19). Jamie's ruling on this, recorded verbatim in the prototype roadmap and still binding:

> *"Never give the key to the agent or they'll try it on every door."*

## 8. What made the prototype good

Carry these forward without renegotiation. Each was expensive to learn and none of them were wrong.

- **The semantic-first bet itself.** It held for seven days across GTK3, GTK4, Qt, and Electron applications, including the discovery that GTK4 exposes frame actions where Qt exposes widget actions (prototype `docs/08-prototype-notes.md`).
- **A frozen wire protocol with generated bindings.** One JSON schema (80 KB, version 1.0, 33 methods) generating a TypeScript validator, a Python validator, and the tool documentation. The freeze *concept* was right. Its *enforcement* was not — see [ADR-0002](02-DECISIONS/0002-schema-freeze-is-a-ci-job.md).
- **Push, not pull.** The desktop talks first (`08-01 10:07`, "the desktop talks first"). Implemented in M2.4 ([ADR-0039](02-DECISIONS/0039-the-desktop-talks-first.md), schema 1.3.0): clients subscribe to one element's subtree and are pushed change events rather than polling for them — nothing polls at any layer.
- **Effects are attributed.** Every observed change says who caused it, with exactly three values — `self` with a cause id when this daemon's open verb did it, `external` when nothing was in flight, and `unattributed` when a verb was in flight but does not bind: the daemon abstains rather than guessing. This is what makes "the human outranks the agent" enforceable rather than aspirational.
- **Episodes as git.** A session's history is a commit graph, not a log file (issue #27). It is inspectable, diffable, and revertible by tools people already have.
- **Proof artifacts as a deliverable.** The prototype produced markdown proofs — *keystrokes reach a field with no way in*, *which credential the voice lane accepts* — generated by scripts that fail loudly rather than write a reassuring file. See [05-TEST-STRATEGY.md](05-TEST-STRATEGY.md).
- **Refusals that explain themselves.** Landed as PR #220. A refusal naming the check that produced it is debuggable; "no" is not.

## 9. What made the prototype hurt

Stated here because product decisions caused some of it. Full treatment in [03-LESSONS.md](03-LESSONS.md).

- **Rework, not throughput, was the constraint.** 332 commits in a week, and the top-churned file was rewritten 35 times (`desktop_service/server.py`). Volume was never the problem.
- **The freeze was a comment.** `protocol/schema.json` was declared frozen on day one at `04:03` and then modified in **twenty-two** further commits, the last on `08-04 10:31`. Nothing failed. Nothing could fail: the freeze was prose.
- **The interesting bugs lived outside the repo.** A sandbox setup command stored in a Postgres column, a maintenance script living in `~/bin`, a memory ceiling in a systemd unit. All three broke silently, and no test in the tree could have caught any of them.
- **Truth was duplicated three ways.** Seven live modules existed as TypeScript source, as emitted JavaScript, and as a vendored copy inside the widget. Parity tests caught the drift, which means the drift kept happening.
- **The face got attention the north star did not.** Visual polish is not free; it competed with the sentence in §2.

## 10. How we will know it works

The product is real when a person who did not build it can do this, on their own machine, in one sitting:

1. Install one package.
2. Sign in with their own model account.
3. Say the wake phrase from across the room and see the face listen provisionally.
4. Ask *"tell me my most recent email"* naturally and hear the complete answer without repeating the wake phrase.
5. Ask a follow-up, then say *"never mind"* or `stop` and see the face return to armed idle.
6. Open the audit log and see exactly which application was read, which elements were **answered**, and that nothing else was. (An element a query walked past and discarded leaves no entry: recording the walk would name nearly every element on the desktop, which is the opposite of what the record is for — [ADR-0050](02-DECISIONS/0050-the-record-names-the-refusal-not-the-sentence.md). This line said *touched* until 2026-08-21.)

Steps 3 through 5 are the product. Step 6 is why anyone will let it near their desktop. Step 1 is why anyone will try.

Every milestone in [07-ROADMAP.md](07-ROADMAP.md) is scored against this list, and each has a verification gate that can fail.

---

## Receipts

| Claim | Source |
|---|---|
| 332 commits, 08-01 → 08-08 | `git rev-list --count` on `computer-controls` |
| 106 merge / 226 non-merge commits | `git rev-list --merges --count` |
| 127 PRs, only #219 open at pivot | `gh pr list --state all` |
| 105 issues | `gh issue list --state all` |
| schema.json changed 23–26× post-freeze | `git log --oneline -- protocol/schema.json` |
| protocol v1.0, 33 methods, 80,127 bytes | the **prototype's** `protocol/schema.json`, on the `computer-controls` checkout named above — not this repository's, which carries 13 methods at v1.5.0 (corrected 2026-08-21; every other row in this table describes the prototype and this one read as a citation into our own tree) |
| `server.py` 35 revisions | `git log --format=%H -- desktop_service/server.py \| wc -l` |
| widget permissions = `["media"]`, `screenCapture: false` | `clients/widget/src/boundaries.test.ts` |
| minted tool surface read-only | hub token-mint tool list; launch tool tracked as issue #183 |
| "Never give the key to the agent…" | prototype `ROADMAP.md`, quoted verbatim |
| unpermitted app invisible | [docs/proofs/an-unpermitted-application-is-invisible.md](proofs/an-unpermitted-application-is-invisible.md) (M2.5, real hardware; supersedes the prototype artifact of the longer name) |
| depth-ceiling retraction | issue #42; re-derived in #45, #58, #60 |
| browser-unreadable-not-absent | commit `6657915` |
| refusals explain themselves | PR #220 (closes issue #184) |

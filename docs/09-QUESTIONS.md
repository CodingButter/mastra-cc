# 09 — Open questions, and what it means to answer them

This document governs the phase before any product code is written. It exists because
the last attempt answered questions by building, discovered the answers were wrong,
and rewrote `desktop_service/server.py` thirty-five times — see [03-LESSONS.md](03-LESSONS.md).

**This phase writes code. None of it survives.** Spikes are throwaway by construction.
If a spike's code looks reusable, that is a signal to stop and notice we started building.

---

## 1. What it means for a question to be closed

A question closes one of two ways. Both are legitimate; the second is much cheaper and
should be preferred whenever it is sufficient.

| Closure | Meaning | Recorded as |
|---|---|---|
| **Answered** | We know the answer, and a receipt proves it. | The answer, plus the command / file:line / measurement that produced it. |
| **Bookmarked** | We do not know, and do not need to yet — but we know exactly where the answer lives when we do. | The specific source: a project, a paper, a spec, a worked example. Not "look it up." |

A question is **not** closed by discussion, by a plausible belief, or by any sentence
containing "should" or "presumably". [ADR-0010](02-DECISIONS/0010-daemon-is-python-single-threaded-default-glib-context.md)
rule 5 already says this for capabilities: probed, never inferred. It applies here too.

Every question below also carries a **what changes** line. If the answer would change
nothing about what we build, the question does not belong in this phase — pick a
default, record it, move on.

---

## 2. Standing rules for this phase

These apply to every question, and to every candidate dependency an answer proposes.

1. **Assume a solution exists; prove it does not.** Research before building. The wake
   detector was hand-rolled and produced the worst episode in the lessons document.
2. **Buy the boring, build the product.** Wake detection, audio plumbing and bus
   transport are commodity — nobody chooses this product for them. The consent model,
   the scope ladder, attestation, honest refusals and per-application invisibility *are*
   the product. Those are not outsourced.
3. **Never buy the decide-then-act loop.** A third-party *binding* that does what it is
   told is fine. A framework that owns the decision of whether to act is not, because
   [ADR-0021](02-DECISIONS/0021-standing-authority-is-armable-attestation-is-not-waivable.md)'s
   attestation guarantee would then run through code we do not control.
4. **Permissive licences only** — MIT, BSD, Apache-2.0, ISC. Not merely "free": this is
   intended to land in an Apache-2.0 tree, so copyleft in a shipped package is a
   blocker. To be enforced by a CI gate over every manifest, not by good intentions.
5. **"Permissive but abandoned" is a separate failure.** Every candidate dependency
   carries both a licence and a last-release / maintenance note.
6. **Prior art before first principles.** Screen readers have solved semantic desktop
   navigation for two decades. Assistant vendors have published wake architectures.
   Reading is cheaper than measuring, and measuring is cheaper than building.

---

## 3. The questions

### A. The accessibility substrate

**Q01 — Does Chromium enable its accessibility engine when an assistive client connects,
or is the launcher flag mandatory?**
*What changes:* if it self-enables, most of
[ADR-0020](02-DECISIONS/0020-granting-an-application-is-a-transaction-with-a-rollback.md)
deletes itself — no shortcut rewriting, no relaunch prompt, no override inventory, no
rollback. This question can only remove work.
*Answer requires:* a transcript showing a Chrome window's tree before and after a client
attaches, on both X11 and Wayland, with Chrome started with no special flags.

**Q02 — Can an application's accessibility capability be determined without launching it?**
*What changes:* whether the permissions page can offer a "check compatibility" button, or
whether compatibility is a state that only becomes known by observation.
*Answer requires:* either a working non-launching probe, or a stated reason it is
impossible — in which case `unknown` becomes a first-class UI state, per the
"not a thing that pretends" non-goal in [00-PRODUCT.md](00-PRODUCT.md).

**Q03 — Is a mail client's message list real semantic structure, or anonymous containers?**
*What changes:* whether the north star sentence is reachable through the accessibility
tree at all. If the answer is soup, the north star needs a different route and the
roadmap is wrong.
*Answer requires:* a dumped tree from at least one webmail-in-Chrome and one native
client, showing whether the message rows carry roles and names, and whether sender,
subject and date are separable fields.

**Q04 — Is Wayland accessibility at parity with X11, and what is missing?**
*What changes:* whether "works on Linux" means one backend or two. Note the observed
fact that `toolkit-accessibility` reads false on the Wayland host but the bus socket
exists anyway — that inconsistency is itself unexplained.
*Answer requires:* the same tree walk run on both session types, with any divergence
named rather than averaged away.

**Q05 — Do GTK4, Qt and Electron applications each need their own enabling step?**
*What changes:* the size and shape of the per-application grant transaction, and whether
[ADR-0017](02-DECISIONS/0017-platform-backends-live-inside-the-daemon.md)'s backend seam
needs a per-toolkit layer beneath it.
*Answer requires:* one confirmed example per toolkit, with whatever step was needed.

**Q06 — How do existing screen readers solve the problems we are about to hit?**
*What changes:* potentially everything below it — this is the prior-art question that
makes the others cheaper. Orca, NVDA and VoiceOver have each solved tree traversal,
caching, event storms, and applications that lie about their state.
*Answer requires:* a bookmarked reading list with specific projects and the specific
mechanism each one is worth reading for. Closure by bookmark is expected here.

### B. What language the daemon is written in

**Q07 — Does a maintained, permissively licensed TypeScript client exist for each
platform's accessibility API?**
Asked as a ladder, three times — Linux (AT-SPI over D-Bus), Windows (UI Automation),
macOS (Accessibility API): (1) a ready client library; (2) failing that, a solid
lower-level binding to build on; (3) failing that, Python stays for that platform.
*What changes:* if TypeScript can reach all three, the Python/TypeScript split
disappears, and the whole Option A/B/C debate in
[04-INTEGRATION-PLAN.md](04-INTEGRATION-PLAN.md) §4 becomes moot. A native Node addon
still counts as yes — it installs from the registry and lives in the monorepo, which a
separate Python process does not.
*Answer requires:* named packages with licence and last-release date, or a documented
absence. Rung 2 answers must include the maintenance note; Node D-Bus libraries have a
history of abandonment.

**Q08 — Is the single-threaded GLib main context requirement a property of the library
or of the protocol?**
*What changes:* [ADR-0010](02-DECISIONS/0010-daemon-is-python-single-threaded-default-glib-context.md)
was hard-won from real silent event loss, but if that constraint lives in the C wrapper
rather than the wire, it does not survive a direct-to-bus implementation.
*Answer requires:* evidence from the protocol specification or from a non-GLib
implementation, not an argument from the library's documentation.

**Q09 — On Windows and macOS, does the "the application must opt in" problem exist at
all, and what replaces it?**
*What changes:* whether the grant transaction is one concept with three shapes, or three
genuinely different consent stories. Bears directly on
[ADR-0019](02-DECISIONS/0019-capability-is-not-authority.md).
*Answer requires:* for each platform, a named mechanism for the OS-level precondition
and whether it is per-application or per-assistive-client.

### C. Mastracode as the backbone

**Q10 — Can the shared coding runtime be embedded as a library, or does it assume it
owns the process and a terminal?**
*What changes:* whether the hub is built on it or merely inspired by it. We have bet the
hub's architecture on twenty minutes of reading.
*Answer requires:* a throwaway program that starts the runtime, runs one trivial tool,
and returns — with no terminal interface present.

**Q11 — Can its permission engine express deny-by-default, and a consent question
answered asynchronously by a remote device?**
*What changes:* if yes, our consent model is configuration and hooks over an existing
engine. If no, it needs its own home, and
[ADR-0023](02-DECISIONS/0023-the-phone-is-a-consent-surface.md) grows a subsystem.
*Answer requires:* demonstrating (a) an unrecognised tool denied rather than prompted,
and (b) an approval resolved by something other than a waiting terminal — the pluggable
resolution policy is the suspected seam.

**Q12 — Is Mastra CC a plugin, a sibling package, or a fork?**
*What changes:* the destination in the integration plan, the conformance rules that
apply, and how much of that document survives. The previous version ran as a plugin;
the factory is a sibling.
*Answer requires:* reading how the factory does it, and a stated choice with its cost.

**Q13 — What comes free, precisely?**
*What changes:* the scope of the hub. Candidates observed but not confirmed: threads and
memory, tool approval persistence, MCP support, language-server integration, plugins,
subagents, goal management.
*Answer requires:* a list where each entry is either confirmed usable as-is, or marked
with what would have to change.

### D. Voice

**Q14 — Which permissively licensed wake-word project, and does it meet the bar?**
*What changes:* removes the hand-rolled fingerprinting that produced the worst episode in
[03-LESSONS.md](03-LESSONS.md) §6.
*Answer requires:* candidates with licence and maintenance status, and a stated position
on custom phrase support — "hey mastra" is not a stock keyword anywhere.

**Q15 — In the prior art, is speaker identification separate from wake detection?**
*What changes:* this is the suspected root cause of the unexplained live offset in
[ADR-0005](02-DECISIONS/0005-wake-is-enrolment-first-fingerprinting.md). We built one
mechanism that does both. Every published assistant appears to stage them.
*Answer requires:* how at least two published systems stage it, and whether verification
runs on the wake audio or on the utterance that follows.

**Q16 — Is there a permissive speech provider that preserves "no audio through the hub"?**
*What changes:* [ADR-0006](02-DECISIONS/0006-hub-holds-no-audio.md) assumes a device
dials a provider directly with a minted token. A self-hosted engine changes who holds
the audio and may make the token machinery unnecessary — or impossible.
*Answer requires:* at least one hosted and one self-hostable option evaluated against
the boundary, not against quality alone.

### E. Consent, security and autonomy — prior art

**Q17 — What did platform runtime-permission models learn the hard way?**
*What changes:* our permissions page is a runtime permission model, and mobile platforms
already moved from install-time to runtime prompts, then to one-time and
while-in-use grants, for documented reasons.
*Answer requires:* bookmarked sources plus the two or three findings that bear on our
grant transaction. Closure by bookmark is expected.

**Q18 — What is the right proof-of-human on a phone, and what does it cost?**
*What changes:* [ADR-0023](02-DECISIONS/0023-the-phone-is-a-consent-surface.md)'s
biometric-at-submit rung stops being hand-waving.
*Answer requires:* a named standard, whether it works from a web page with no app store
presence, and what it requires of the hub.

**Q19 — How do existing unattended agents handle the operator being away?**
*What changes:* [ADR-0022](02-DECISIONS/0022-failure-to-act-is-harm-we-caused.md) is our
most opinionated decision and has no prior art behind it yet. If everyone else halts on
uncertainty, we should understand why before doing the opposite.
*Answer requires:* two or three worked examples of how divergence and unreachability are
handled, and whether anyone treats failing to act as reportable harm.

### F. Rulings — no research needed

**Q20 — Are episodes and the audit log one artifact or two?**
*What changes:* whether redaction happens at write time or read time — very expensive to
reverse later. Carried unresolved from
[01-ARCHITECTURE.md](01-ARCHITECTURE.md) §9 and
[ADR-0013](02-DECISIONS/0013-episodes-are-a-git-graph.md).
*Answer requires:* a decision and an ADR. Nothing to measure.

---

## 4. Ruled non-blocking

Recorded so nobody re-derives them.

| Question | Why it does not block |
|---|---|
| Where the phone's transport terminates when off-network | Changes no line of the skeleton; a relay can be added behind the existing transport seam. |
| Re-measuring the wake threshold | Already decided: rebuild capture once and re-measure *on the rebuilt path*. That happens when the wake gate is built, not now. |
| Orb and face visual design | Deferred until the north star passes, per [07-ROADMAP.md](07-ROADMAP.md). |

---

## 5. Exit condition for this phase

All of the following, or the phase is not finished:

1. Every question above is **answered** or **bookmarked**, with its stated requirement met.
2. `scripts/check-docs.py` exits 0.
3. Findings are written down where the work will happen — an amended ADR, a new ADR, or
   a correction to an existing document. A finding that lives only in a spike's output is
   not recorded.
4. Any decision invalidated by a finding is **superseded in writing**, not quietly edited.
5. A cold reader — a person, or an agent session with no memory of these conversations —
   can read the documents and begin the skeleton without asking us anything.

**Discipline clause.** No new decision record during this phase unless a finding forces
one. Wanting to write an ADR because we had a good idea is the signal that we have
drifted from converging back to generating.

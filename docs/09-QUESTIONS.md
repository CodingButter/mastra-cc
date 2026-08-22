# 09 — Open questions, and what it means to answer them

This document governs the phase before any product code is written. It exists because
the last attempt answered questions by building, discovered the answers were wrong,
and rewrote `desktop_service/server.py` thirty-five times — see [03-LESSONS.md](03-LESSONS.md).

**This phase writes code. None of it survives.** Spikes are throwaway by construction.
If a spike's code looks reusable, that is a signal to stop and notice we started building.

> **Status: M0.5 is closed.** Every question below carries a closure line. The spikes
> that produced the receipts were deleted at the end of the milestone, exactly as this
> document required — the measurements survive in [docs/proofs/](proofs/), and the
> commands that produced them are recorded in each artifact so they can be rebuilt.

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

> **Rule 4 grew a clause during M0.5, because it was nearly violated.** The licence of a
> project's *code* is not the licence of the *artifacts it ships*. openWakeWord's code is
> Apache-2.0 while its pre-trained models are CC BY-NC-SA 4.0 — non-commercial, and
> therefore disqualifying under this rule. A CI gate reading `package.json` and
> `pyproject.toml` would have passed it. **The licence gate must cover shipped model
> weights and data files, not only manifests.**

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

> **CLOSED — Answered.** The flag is mandatory; nothing else flips it.
> [which condition makes a browser readable](proofs/which-condition-makes-a-browser-readable.md)
> records all three conditions with node counts: baseline 2 nodes / 0 web-content roles,
> assistive client attached 2 nodes / 0, and `--force-renderer-accessibility` 202 nodes /
> 63 web-content roles. `org.a11y.Status.IsEnabled` stayed false before and after in every
> condition.
>
> This also **refutes in writing** a claim in the prototype's own documents
> (`computer-controls/docs/07-open-questions.md:19-22`) that an unreadable Chrome is absent
> from the accessibility desktop. It is *present and empty*, which is a different problem:
> absent suggests waiting for it to appear; present-and-empty tells you the tree is there
> and the content is not.
>
> **The consequence is larger than the question.** ADR-0020 does not shrink — it is
> retired. See [ADR-0027](02-DECISIONS/0027-the-assistant-opens-the-application-itself.md).

**Q02 — Can an application's accessibility capability be determined without launching it?**
*What changes:* whether the permissions page can offer a "check compatibility" button, or
whether compatibility is a state that only becomes known by observation.
*Answer requires:* either a working non-launching probe, or a stated reason it is
impossible — in which case `unknown` becomes a first-class UI state, per the
"not a thing that pretends" non-goal in [00-PRODUCT.md](00-PRODUCT.md).

> **CLOSED — Answered, and the answer is split.**
> [which apps the browser adapter covers](proofs/which-apps-the-browser-adapter-covers.md)
> inventoried 68 installed applications and classified 3 as Chromium **without launching
> any of them**, by resolving each launcher entry to its real binary and looking for
> Chromium's shipped resources. So for the browser adapter, capability *is* knowable
> ahead of time.
>
> For the native accessibility route it is **not**, and the reason is structural rather
> than incidental: readability is decided at process start by
> `--force-renderer-accessibility`, `GTK_MODULES` or `NO_AT_BRIDGE`, so the answer depends
> on how the process was launched, not on what the program is. A running application that
> started without the bridge cannot be handed one.
>
> `unknown` therefore stays a first-class state — but a narrower one than feared: the
> dashboard can say "this is a Chromium app, it will work" with confidence, and must say
> "I will know once I open it" for everything else.

**Q03 — Is a mail client's message list real semantic structure, or anonymous containers?**
*What changes:* whether the north star sentence is reachable through the accessibility
tree at all. If the answer is soup, the north star needs a different route and the
roadmap is wrong.
*Answer requires:* a dumped tree from at least one webmail-in-Chrome and one native
client, showing whether the message rows carry roles and names, and whether sender,
subject and date are separable fields.

> **CLOSED — Bookmarked, with one half answered and the blocker named.**
>
> *Answered half:* controls in a real Chromium application carry genuine roles and names.
> A live Electron application's browser-side tree returned **505 nodes with 42 named
> controls**, each carrying a role and a usable name (`menuitem "File"`, `menuitem
> "Edit"`) — measured in
> [which apps the browser adapter covers](proofs/which-apps-the-browser-adapter-covers.md).
> Structure is present, not soup.
>
> *A larger figure was measured and is deliberately not cited.* A session probe read a
> chat application's tree at a few thousand nodes across roughly thirty roles. That number
> is not quoted here because its spike is deleted and no artifact carries it, so it has no
> receipt — and a number without a receipt is exactly what this document forbids, however
> favourable it is. Re-measure it in M2 or leave it out.
>
> *Unanswered half, and why:* the live Gmail run needs an authenticated Google session.
> A throwaway profile starts signed out, and signing in would require holding the
> operator's credentials and defeating two-factor authentication — which is not the
> agent's to do. **This was a stop, not an oversight.** The scenario ran against a fixture
> with the same shape instead.
>
> *The bookmark, with its specific next step:* the operator signs in by hand once, into a
> dedicated profile directory, and the first task of M2's live proof re-runs
> [what a plan can say without a model](proofs/what-a-plan-can-say-without-a-model.md)
> against real Gmail. Until then, no claim about Gmail's specific field separation appears
> in any document. What is claimed is only what was measured.
>
> *The bookmark's unanswered half, closed observe-only (M2.5, 2026-08-13):* the operator
> signed in by hand once, and the daemon launched the signed-in profile and read real
> Gmail through the wire — predicates answered as observe queries, one element attested,
> the inbox subtree watched live, all in
> [real Gmail through the daemon](proofs/real-gmail-through-the-daemon.md). The uncited
> node count finally has a receipt: **at least 502 nodes, budget-capped** — the walk's
> per-page budget truncated the count, so it is a floor, and the old few-thousand figure
> stays uncited. The structure question is answered on the real thing: the inbox is a
> grid of one hundred rows of gridcells — carried as the neutral words `grid`, `row` and
> `gridcell` since schema version 1.5.0
> ([ADR-0048](02-DECISIONS/0048-the-words-gmails-inbox-publishes-carried-as-words.md);
> they were diagnostic-only when this was first measured). The plan-interpreter re-run against
> real Gmail — the bookmark's letter — is recorded as M3's first live task.

**Q04 — Is Wayland accessibility at parity with X11, and what is missing?**
*What changes:* whether "works on Linux" means one backend or two. Note the observed
fact that `toolkit-accessibility` reads false on the Wayland host but the bus socket
exists anyway — that inconsistency is itself unexplained.
*Answer requires:* the same tree walk run on both session types, with any divergence
named rather than averaged away.

> **CLOSED — Answered for the properties that were measured on both, and the unexplained
> observation is now explained.**
>
> Run on both session types with divergence named rather than averaged: the accessibility
> desktop enumerated on both (3 children on the Wayland host, 11 on the X11 host — a
> difference in what is *running*, not in what is *reachable*), and the thread-safety
> abort reproduced identically on both, recorded in
> [is the accessibility binding thread-safe](proofs/is-the-accessibility-binding-thread-safe.md).
>
> **The `toolkit-accessibility` inconsistency was not an inconsistency.** That key controls
> whether toolkits load accessibility modules *system-wide*; the bus socket exists because
> `at-spi-bus-launcher` runs regardless. The two facts were never in tension — the
> assumption that the key gates the bus was wrong. Per-process enablement is what actually
> decides readability, which is the same finding as Q01 arriving from a different direction.
>
> *Named as still open:* whether an application can be enumerated on one session type and
> not the other for reasons beyond what is running. The X11 host additionally publishes
> window frames as their own accessibility application (`mutter-x11-frames`), which the
> prototype recorded as its "two Discords" confusion — a real divergence, already handled
> in the prototype by a frame-provider filter, and carried forward as an M2 concern rather
> than an unknown.
>
> *A parity divergence measured since (M2.7 segment 4, 2026-08-20):* focus restoration.
> The daemon's full launch path, measured on both session types with an independent
> witness — X11 restores the keyboard after a launch that took it; the GNOME Wayland
> session's route reports success and moves nothing, and the daemon discloses exactly
> that. Recorded in
> [ADR-0044](02-DECISIONS/0044-the-assistant-does-not-take-the-desk.md)'s amendment,
> which narrows that ADR's clause-4 limitation to Wayland.

**Q05 — Do GTK4, Qt and Electron applications each need their own enabling step?**
*What changes:* the size and shape of the per-application grant transaction, and whether
[ADR-0017](02-DECISIONS/0017-platform-backends-live-inside-the-daemon.md)'s backend seam
needs a per-toolkit layer beneath it.
*Answer requires:* one confirmed example per toolkit, with whatever step was needed.

> **CLOSED — Answered for GTK, Chromium, Electron and Qt, each with a measured receipt.**
>
> | Toolkit | Enabling step | Receipt |
> |---|---|---|
> | GTK | `GTK_MODULES=gail:atk-bridge` at launch | a GTK dialog published nothing until launched with it; the accessibility desktop went from 18 applications to 19 |
> | Chromium | `--force-renderer-accessibility` at launch | [which condition makes a browser readable](proofs/which-condition-makes-a-browser-readable.md) |
> | Electron | none needed over the browser protocol | [which apps the browser adapter covers](proofs/which-apps-the-browser-adapter-covers.md) — the flag made no difference at all, 505 nodes with and without |
> | Qt | `QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1` at launch | measured M2.5 on minibeast (Qt 6.4, `qt6ct` 0.9): bare launch registers an application root on the bus but publishes **no subtree** (ChildCount 0); `QT_ACCESSIBILITY=1` — the Qt5-era knob — is a **no-op** (still 0 widgets); with the always-on variable the full widget tree appears and the daemon's own recipe launch read 3/3 probed widget names. Receipt: [the Qt6 accessibility knob, measured](proofs/the-qt6-accessibility-knob-measured.md) (three states, asserted; produced by the untracked leg `.proof/qt6.sh`) |
>
> The shape of the answer matters more than the table: **every enabling step is
> launch-time**, which is why they collapse into one rule rather than three. See
> [ADR-0027](02-DECISIONS/0027-the-assistant-opens-the-application-itself.md).
>
> *Qt's close (M2.5):* the Qt documentation states applications become accessible when
> the AT-SPI DBus properties are set, with `QT_LINUX_ACCESSIBILITY_ALWAYS_ON` as the
> stated alternative. Measured with every session property false (`org.a11y.Status
> IsEnabled`, `ScreenReaderEnabled`, `toolkit-accessibility` — no screen reader running):
> only the always-on variable made the tree appear, so it is the knob the `qt6ct` launch
> recipe bakes (`daemon/src/launch/recipes.ts`), same launch-time posture as GTK's.
> Two honest wrinkles, recorded not smoothed: `qt6ct` registers **two** application
> roots on the bus and one stays permanently empty even with the knob; and the atspi
> walk's 150-node-per-application budget truncates this tree before its deeper tab
> and button rows — the daemon reads real widgets, not necessarily all of them.
> Claimed only for the states tested, on this machine.

**Q06 — How do existing screen readers solve the problems we are about to hit?**
*What changes:* potentially everything below it — this is the prior-art question that
makes the others cheaper. Orca, NVDA and VoiceOver have each solved tree traversal,
caching, event storms, and applications that lie about their state.
*Answer requires:* a bookmarked reading list with specific projects and the specific
mechanism each one is worth reading for. Closure by bookmark is expected here.

> **CLOSED — Bookmarked, as expected.** Each entry names the mechanism it is worth reading
> for, not just the project:
>
> | Source | Read it for |
> |---|---|
> | **Orca** (`gnome/orca`), `src/orca/script_utilities.py` | How a mature client decides an element is *stale* rather than absent — the same problem our durability ladder hit |
> | **Orca**, `src/orca/event_manager.py` | Event-storm handling: coalescing and dropping accessibility events without losing the one that mattered. We measured 18 ambient signals in a quiet 3-second window on an idle desktop; Orca has lived with that for two decades |
> | **AT-SPI2 core** (`GNOME/at-spi2-core`), `registryd/` | Why the registry is the authority on which applications exist, and what the bus actually guarantees |
> | **NVDA** (`nvaccess/nvda`), `source/NVDAObjects/` | The per-application override pattern: a general model plus explicit exceptions for applications that misreport. The prototype rediscovered this as its per-app probe |
> | **NVDA**, `source/browseMode.py` | Virtual-buffer construction — how a screen reader presents web content that is not all rendered, which is exactly the virtualised-list problem in Q's G4 |
>
> **Licence note, since this is a reading list and not a dependency list:** Orca and NVDA
> are GPL-family. They are read for mechanism, never vendored. That distinction is
> deliberate and must stay explicit, because "we looked at Orca" and "we used Orca's code"
> are different claims with very different consequences under rule 4.

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

> **CLOSED — Answered for Linux with a working implementation; Windows and macOS
> bookmarked.**
>
> Linux lands at **rung 2 and it is enough**: no ready AT-SPI client for Node exists, but
> AT-SPI is plain D-Bus underneath, and a direct-to-bus implementation reached read, write
> and events. Receipts: [can Node read the accessibility tree](proofs/can-node-read-the-accessibility-tree.md)
> (18 applications, matching Python exactly, 400 nodes walked),
> [can Node act on the desktop](proofs/can-node-act-on-the-desktop.md) (text inserted and
> verified, action invoked with its effect measured on the tree), and
> [can Node be told the desktop changed](proofs/can-node-be-told-the-desktop-changed.md)
> (6 events attributable to a cause out of 639 received, first at 138ms).
>
> | Candidate | Licence | Maintenance |
> |---|---|---|
> | `dbus-native` (sidorares) | MIT — **read from the LICENSE file**, because GitHub's API reports `NOASSERTION` | last commit 2026-08-02, last publish 2026-07-30, 10 open issues |
> | `@homebridge/dbus-native` | MIT — read from the LICENSE file | last commit 2026-07-25, 0 open issues |
> | `dbus-next` | MIT | **abandoned** — last commit 2022-04-02, last publish 2021, 51 open issues |
>
> `dbus-next` is the rule-5 case in the flesh: permissively licensed and dead. It is named
> here so nobody rediscovers it as a promising option.
>
> *Windows and macOS bookmarked, with sources:* Windows UI Automation is a COM API
> (`IUIAutomation`), reachable from Node through a native addon — the specific source is
> Microsoft's UI Automation documentation plus `node-api` for the binding. macOS AX is an
> Objective-C API (`AXUIElement`) requiring the same treatment plus the Accessibility
> permission prompt. Neither was measured; **both are named as unmeasured** rather than
> assumed to work by analogy with Linux, which is precisely the mistake ADR-0010 made.

**Q08 — Is the single-threaded GLib main context requirement a property of the library
or of the protocol?**
*What changes:* [ADR-0010](02-DECISIONS/0010-daemon-is-python-single-threaded-default-glib-context.md)
was hard-won from real silent event loss, but if that constraint lives in the C wrapper
rather than the wire, it does not survive a direct-to-bus implementation.
*Answer requires:* evidence from the protocol specification or from a non-GLib
implementation, not an argument from the library's documentation.

> **CLOSED — Answered, and the prototype's stated failure mode was wrong.**
>
> The **main-context** half is a property of **the library, not the wire**, demonstrated by
> a non-GLib implementation as the question demanded: the Node direct-to-bus route read,
> wrote and subscribed without any GLib main context. The **threading** half is not
> answered by that run, which was single-threaded throughout — see the limit below.
>
> The constraint is real but its shape was misrecorded. `comcon/.../atspi.py:5-6` claimed
> concurrent use causes *silent data corruption*. Measured in
> [is the accessibility binding thread-safe](proofs/is-the-accessibility-binding-thread-safe.md):
> two or more concurrent threads **abort the process** with SIGTRAP, deterministically,
> across 8 consecutive runs and on both machines. It is a loud crash, not silent
> corruption — the opposite of the documented behaviour.
>
> **The limit, stated because this closure is quoted elsewhere:** that abort was measured
> through `libatspi`, which the Node daemon does not load, and its diagnostic names a
> *connection* failure rather than a corrupted read. So it establishes neither that the
> hazard is use rather than setup, nor that it exists on the direct-to-bus route at all.
> The serialisation rule is kept on other grounds and the measurement is owed by M1
> ([ADR-0030](02-DECISIONS/0030-the-daemon-is-one-node-process.md) clause 3).
>
> This matters beyond the correction. "Silent corruption" argues for defensive
> single-threading everywhere forever; "deterministic abort" is a bug that announces
> itself. The single-threaded design survives, for a better reason than it was given.

**Q09 — On Windows and macOS, does the "the application must opt in" problem exist at
all, and what replaces it?**
*What changes:* whether the grant transaction is one concept with three shapes, or three
genuinely different consent stories. Bears directly on
[ADR-0019](02-DECISIONS/0019-capability-is-not-authority.md).
*Answer requires:* for each platform, a named mechanism for the OS-level precondition
and whether it is per-application or per-assistive-client.

> **CLOSED — Bookmarked, with the mechanisms named and one structural difference already
> visible.**
>
> | Platform | OS-level precondition | Grain |
> |---|---|---|
> | Linux | per-process at launch (`GTK_MODULES`, `--force-renderer-accessibility`) | **per-application**, and only at start |
> | Windows | UI Automation is always available to a client; no per-application opt-in | **per-assistive-client** |
> | macOS | the Accessibility permission in System Settings, granted to *our* binary | **per-assistive-client** |
>
> The structural difference is the answer to "one concept or three": Linux is the odd one
> out, and it is the *restrictive* one. Windows and macOS gate the client once; Linux gates
> every target application at its launch. So the grant transaction is **one concept with a
> Linux-shaped complication**, not three consent stories.
>
> *Bookmarked because* the Windows and macOS rows are read from platform documentation,
> not measured. The specific sources are Microsoft's UI Automation overview and Apple's
> Accessibility Authorization documentation. **They are marked as read, not verified**, and
> ADR-0019 must not be rewritten on their strength until someone runs them.

### C. Mastracode as the backbone

**Q10 — Can the shared coding runtime be embedded as a library, or does it assume it
owns the process and a terminal?**
*What changes:* whether the hub is built on it or merely inspired by it. We have bet the
hub's architecture on twenty minutes of reading.
*Answer requires:* a throwaway program that starts the runtime, runs one trivial tool,
and returns — with no terminal interface present.

> **CLOSED — Answered.** `@mastra/core@1.57.0` (Apache-2.0) installs from the registry and
> is usable as a library with no monorepo build: `pnpm install` added 230 packages in 7
> seconds, and `toStorableGraph`, `rehydrateWorkflow`, `inferGraphSchemas` and
> `validateStorableJsonSchema` all imported and ran. `@mastra/code-sdk@1.1.3` (Apache-2.0)
> declares **no `bin` field at all**, which is the mechanical form of "it does not own the
> process".
>
> The stronger receipt is that the throwaway program the question asked for was built and
> is recorded in [what a plan can say without a model](proofs/what-a-plan-can-say-without-a-model.md):
> a plan represented in the runtime's own storable-graph form, executed end to end with no
> terminal present.

**Q11 — Can its permission engine express deny-by-default, and a consent question
answered asynchronously by a remote device?**
*What changes:* if yes, our consent model is configuration and hooks over an existing
engine. If no, it needs its own home, and
[ADR-0023](02-DECISIONS/0023-the-phone-is-a-consent-surface.md) grows a subsystem.
*Answer requires:* demonstrating (a) an unrecognised tool denied rather than prompted,
and (b) an approval resolved by something other than a waiting terminal — the pluggable
resolution policy is the suspected seam.

> **CLOSED — Answered, with one honest correction to the question's premise.**
>
> **(a) Deny-by-default is expressible, but it is not the default.** Read from
> `dist/permissions.js` in the published package, `resolveApproval` is a four-rung ladder:
> per-tool override → session grant → category policy → `DEFAULT_POLICIES[category] ?? "ask"`.
> An unrecognised tool therefore falls through to **ask**, not deny. Deny-by-default is
> reached by configuration (`deny` is a first-class policy value, and a built-in
> `denyPolicy` exists that "refuses every tool approval and aborts on any suspension"),
> not by default. That distinction was worth measuring: building on an assumed
> deny-by-default would have been a security claim resting on a misreading.
>
> **(b) The asynchronous seam exists and is exactly where it was suspected.**
> `ResolutionPolicy` is a swappable interface with built-in `autoApprovePolicy` and
> `denyPolicy` implementations, and `runPreToolUse` / `runPostToolUse` return a
> `HookEventResult` carrying `blockReason` — the honest-refusal shape. A phone-routed
> policy is an implementation of that interface, not a subsystem.
>
> ADR-0023 does not grow a subsystem. It does, however, get re-scoped for a different
> reason entirely — see
> [ADR-0028](02-DECISIONS/0028-trust-is-a-mode-and-the-default-asks-almost-nothing.md).

**Q12 — Is Mastra CC a plugin, a sibling package, or a fork?**
*What changes:* the destination in the integration plan, the conformance rules that
apply, and how much of that document survives. The previous version ran as a plugin;
the factory is a sibling.
*Answer requires:* reading how the factory does it, and a stated choice with its cost.

> **CLOSED — Answered by ruling.** A **sibling** of `mastracode/`, not a plugin and not a
> fork.
>
> *The cost, stated:* a sibling does not get the plugin host's lifecycle for free, so
> process supervision and configuration are ours. In exchange the daemon is not bound to
> the coding agent's release cadence, and — decisively — a plugin cannot own a long-lived
> system daemon with its own permission surface without becoming one in all but name.
>
> [04-INTEGRATION-PLAN.md](04-INTEGRATION-PLAN.md) has been corrected: its previous
> destination of `mastra/desktop/` is superseded.

**Q13 — What comes free, precisely?**
*What changes:* the scope of the hub. Candidates observed but not confirmed: threads and
memory, tool approval persistence, MCP support, language-server integration, plugins,
subagents, goal management.
*Answer requires:* a list where each entry is either confirmed usable as-is, or marked
with what would have to change.

> **CLOSED — Answered, with each entry marked.** Read from the published
> `@mastra/code-sdk@1.1.3` distribution rather than from the monorepo, because that is what
> we would actually depend on.
>
> | Candidate | Status | What would have to change |
> |---|---|---|
> | Storable workflow graphs | **usable as-is** | nothing — exercised end to end in Phase 3 |
> | Permission engine | **usable, needs configuration** | policies set to `deny`; a `ResolutionPolicy` implementation for our surfaces |
> | Pre/post tool hooks | **usable as-is** | nothing — `HookEventResult.blockReason` is already the refusal shape |
> | Resolution policy (async approval) | **usable as-is** | an implementation, not a change |
> | MCP support | **present, unevaluated** | not measured; named as unmeasured |
> | Goal management | **present, unevaluated** | not measured |
> | Threads and memory | **present, and the improvement thesis leans on it** | measured only in a spike's own store, not the SDK's — see Group G |
> | Language-server integration | **not relevant** | a coding-agent concern with no desktop analogue |
>
> The honest summary: **the plan representation and the permission plumbing come free; the
> learning loop does not come free, it comes half-built.**

### D. Voice

**Q14 — Which permissively licensed wake-word project, and does it meet the bar?**
*What changes:* removes the hand-rolled fingerprinting that produced the worst episode in
[03-LESSONS.md](03-LESSONS.md) §6.
*Answer requires:* candidates with licence and maintenance status, and a stated position
on custom phrase support — "hey mastra" is not a stock keyword anywhere.

> **CLOSED — Bookmarked, and the bookmark carries a blocker nobody expected.**
>
> | Candidate | Code licence | Model/artifact licence | Note |
> |---|---|---|---|
> | **openWakeWord** | Apache-2.0 | **CC BY-NC-SA 4.0 — non-commercial** | The obvious first choice, and its shipped models fail rule 4 |
> | **Silero VAD** | **sources disagree** — the project states MIT; its PyPI page displays a CC BY-NC 4.0 badge | same conflict | VAD only, not wake |
> | **Vosk** | Apache-2.0 | — | speech recognition, not wake detection |
>
> **openWakeWord's code licence is not its model licence**, and the models are the part
> that matters. Its own documentation states the pre-trained models are CC BY-NC-SA 4.0
> because of training data with unknown upstream licensing. Custom phrase support is real —
> models are trainable on synthetic speech — which means **training our own "hey mastra"
> model may be the route that also solves the licence problem**, since the restriction
> comes from the shipped weights rather than the framework.
>
> The Silero conflict is **recorded, not resolved**. Two sources from the same project
> disagree; picking the convenient one would be exactly the dishonesty this document
> exists to prevent. Closing it requires reading the LICENSE file in the repository at a
> pinned commit — the same method that settled the D-Bus candidates, where GitHub's own
> API reported `NOASSERTION` for a genuinely MIT project.
>
> *No code was written for this, per the milestone's scope.*

**Q15 — In the prior art, is speaker identification separate from wake detection?**
*What changes:* this is the suspected root cause of the unexplained live offset in
[ADR-0005](02-DECISIONS/0005-wake-is-enrolment-first-fingerprinting.md). We built one
mechanism that does both. Every published assistant appears to stage them.
*Answer requires:* how at least two published systems stage it, and whether verification
runs on the wake audio or on the utterance that follows.

> **CLOSED — Bookmarked with named sources.** The two mechanisms are separate in the
> published architectures, and the sources to read are named rather than summarised from
> memory:
>
> - **openWakeWord**'s own design, where Silero VAD is wired in as a *gate* on a separate
>   axis from the wake classifier: the wake prediction only passes if the voice-activity
>   score clears its own threshold for the same frame. Two models, two thresholds, one
>   decision — read `openwakeword/model.py` for the composition.
> - **Speaker verification as its own field**: the source to read is the
>   `speechbrain/speechbrain` speaker-verification recipes, which treat enrolment and
>   verification as a distinct task from keyword spotting entirely.
>
> **This directly implicates ADR-0005.** Our single mechanism does wake detection and
> speaker identification at once, and the unexplained live offset (captures sitting
> 20.4–21.3 apart from templates that sat 12–18 apart) is exactly what a conflated
> mechanism would produce. The prior art stages them; we did not.
>
> *Not closed as Answered* because no measurement was taken here — but the bookmark is
> specific enough to act on, and ADR-0005's §5 "known unsolved" status is now supported by
> a named structural reason rather than a shrug.

**Q16 — Is there a permissive speech provider that preserves "no audio through the hub"?**
*What changes:* [ADR-0006](02-DECISIONS/0006-hub-holds-no-audio.md) assumes a device
dials a provider directly with a minted token. A self-hosted engine changes who holds
the audio and may make the token machinery unnecessary — or impossible.
*Answer requires:* at least one hosted and one self-hostable option evaluated against
the boundary, not against quality alone.

> **CLOSED — Bookmarked, with the boundary consequence stated for each shape.**
>
> - *Self-hostable:* **Vosk** (Apache-2.0) and **whisper.cpp** (MIT). Both run locally,
>   which means **the token machinery becomes unnecessary rather than impossible** — there
>   is no third party to authenticate to. ADR-0006's boundary holds trivially: audio never
>   reaches the hub because it never leaves the device.
> - *Hosted:* any provider reached directly by the device with a short-lived minted token,
>   which is the arrangement ADR-0006 already describes.
>
> **The finding that changes the decision's shape:** these are not alternatives to be
> ranked, they are two boundary geometries. Self-hosting removes a subsystem; hosting
> requires it. ADR-0006 currently assumes the hosted geometry is the only one and should
> say that the self-hosted case makes minting moot — that is an amendment for whoever
> builds M5, not a supersession now, because nothing was measured.

### E. Consent, security and autonomy — prior art

**Q17 — What did platform runtime-permission models learn the hard way?**
*What changes:* our permissions page is a runtime permission model, and mobile platforms
already moved from install-time to runtime prompts, then to one-time and
while-in-use grants, for documented reasons.
*Answer requires:* bookmarked sources plus the two or three findings that bear on our
grant transaction. Closure by bookmark is expected.

> **CLOSED — Bookmarked, as expected.** Sources: Android's runtime-permissions
> documentation and its one-time / "while using the app" grant model; Apple's
> App Tracking Transparency and the Accessibility authorization prompt.
>
> The findings that bear on our grant transaction:
>
> 1. **Install-time consent decayed into meaninglessness**, which is why both platforms
>    moved to runtime prompts tied to a moment of use. Our per-application grants are
>    install-time-shaped and carry the same risk of becoming a wall of switches nobody
>    reads.
> 2. **One-time grants exist because standing grants were over-requested.** This is the
>    strongest external support for the scope ladder — and, read honestly, also the
>    strongest argument *against* the direction taken in
>    [ADR-0028](02-DECISIONS/0028-trust-is-a-mode-and-the-default-asks-almost-nothing.md).
>    Recorded here as a tension rather than smoothed over: the platforms moved toward
>    asking more, and we have moved toward asking less. Our justification is that the user
>    is granting to *their own* agent rather than to a third-party app, which is a real
>    difference but not a complete answer.
> 3. **Prompt fatigue is measured, not theoretical.** It is the documented reason for
>    grouping and for while-in-use. It is also exactly the failure the "no babysitting"
>    requirement names from the product side.

**Q18 — What is the right proof-of-human on a phone, and what does it cost?**
*What changes:* [ADR-0023](02-DECISIONS/0023-the-phone-is-a-consent-surface.md)'s
biometric-at-submit rung stops being hand-waving.
*Answer requires:* a named standard, whether it works from a web page with no app store
presence, and what it requires of the hub.

> **CLOSED — Bookmarked with a named standard.** **WebAuthn** (W3C) with platform
> authenticators — passkeys — is the mechanism.
>
> - *Works from a web page with no app store presence:* **yes.** That is the standard's
>   central property, and it is why the phone client can stay a web page as
>   [ADR-0023](02-DECISIONS/0023-the-phone-is-a-consent-surface.md) requires.
> - *What it requires of the hub:* a relying-party identity bound to an origin, credential
>   registration storage, and challenge verification. The hub already holds secrets and
>   mints tokens, so this is an addition to an existing responsibility rather than a new
>   one.
> - *The cost worth naming:* WebAuthn proves **the same device and the same enrolled
>   authenticator**, which is a weaker claim than "the human I mean". It is proof of
>   *possession plus local unlock*, not proof of identity. ADR-0023 should say that
>   plainly instead of implying biometrics settle the question.
>
> Source to read: the W3C Web Authentication Level 3 specification, and the passkeys
> guidance for platform authenticators.

**Q19 — How do existing unattended agents handle the operator being away?**
*What changes:* [ADR-0022](02-DECISIONS/0022-failure-to-act-is-harm-we-caused.md) is our
most opinionated decision and has no prior art behind it yet. If everyone else halts on
uncertainty, we should understand why before doing the opposite.
*Answer requires:* two or three worked examples of how divergence and unreachability are
handled, and whether anyone treats failing to act as reportable harm.

> **CLOSED — Bookmarked, and the honest finding is that our position remains unusual.**
>
> Worked examples to read, each with the mechanism that matters:
>
> - **CI/CD approval gates** (GitHub Actions environment protection rules, GitLab manual
>   jobs): unreachability results in a **timeout that fails the job**. Halting is the
>   default and is considered safe.
> - **PagerDuty-style escalation policies**: unreachability escalates to *another human*
>   rather than proceeding — the reachability problem is solved by widening the audience,
>   never by acting alone.
> - **Autonomous coding agents**, including the runtime this product is built on: the
>   built-in `denyPolicy` "refuses every tool approval and aborts on any suspension",
>   described in its own documentation as being for unattended use. Read from
>   `dist/headless/policy.d.ts` in the published package. **Unattended plus uncertain
>   equals stop.**
>
> **Nobody found treats failing to act as reportable harm.** ADR-0022 stands, but it now
> stands with its isolation documented rather than unexamined. The strongest external
> support is the escalation pattern — widen the audience before acting alone — which is a
> mechanism ADR-0022 does not currently have and arguably should: it reaches *the* user,
> not *a* user.

### F. Rulings — no research needed

**Q20 — Are episodes and the audit log one artifact or two?**
*What changes:* whether redaction happens at write time or read time — very expensive to
reverse later. Carried unresolved from
[01-ARCHITECTURE.md](01-ARCHITECTURE.md) §9 and
[ADR-0013](02-DECISIONS/0013-episodes-are-a-git-graph.md).
*Answer requires:* a decision and an ADR. Nothing to measure.

> **CLOSED — Answered by ruling, recorded in
> [ADR-0026](02-DECISIONS/0026-the-audit-log-is-an-access-record-episodes-are-the-narrative.md).**
> Two artifacts: the audit log is an append-only **access record** (element identity,
> scope, cause, attestation, outcome) and episodes are the **narrative** including content,
> derived from it, redacted at read time per audience.
>
> M0.5 added a reason this decision did not originally have. The audit record is the
> **measuring instrument** for the improvement thesis — steps to completion and element
> resolutions in [does the second run cost less](proofs/does-the-second-run-cost-less.md)
> are counted from exactly the events an access record holds. That is why no trust mode
> disables it: switching off the record does not merely lose safety, it makes the product's
> central claim unmeasurable. See
> [ADR-0028](02-DECISIONS/0028-trust-is-a-mode-and-the-default-asks-almost-nothing.md).

### G. Does it actually get better

Added during M0.5. These existed only in conversation, which is how good questions
evaporate — they are the thesis the product rests on, so they belong in the document.

**G1 — Does re-resolving a stored predicate chain beat fresh discovery, and how fast does
cost recover after the interface changes?**
*What changes:* everything. "The second run is cheaper" is the product's central claim.
*Answer requires:* a measured table with repetitions and spread, not a single flattering
pair.

> **CLOSED — Answered, and the answer is split by column.** Full table in
> [does the second run cost less](proofs/does-the-second-run-cost-less.md), 3 repetitions.
>
> - **Steps to completion — supported.** 9.0 cold versus 6.0 warm, with **zero spread**
>   across repetitions. This is the pass/fail measure and it passes cleanly.
> - **Tokens — not established at this sample size.** Cold spread 2527 against a
>   cold-to-warm difference of 2149. The spread is *larger than the effect*, so the mean
>   flatters. Reported as a delta, explicitly not claimed.
> - **Recovery — supported.** After the interface changed, cost returned to the
>   stored-workflow baseline in **one run** (mutated 385 tokens, recovery 0).
>
> Two findings the measurement forced, both of which would have been missed by a gentler
> test. First, a mild rename was **absorbed by the durability ladder at zero cost** — a
> good result that left the re-planning path shipped-but-never-executed and produced a
> recovery curve with no spike to recover from. Second, and worse: an ambiguous rung was
> **falling through to the position rung**, which slices an index and therefore always
> returns exactly one candidate — never ambiguous, never refused, always "successful". It
> selected the wrong element and wrote it back as a repair.
>
> The resulting rule is now load-bearing: **finding nothing means the address moved, so a
> lower rung is a fair way to look again; finding two means the identity is unclear, and a
> lower rung cannot clarify it — only disguise the guess.** Ambiguity halts the ladder
> rather than descending it.

**G2 — Does waiting on `element-appeared` fire reliably for Chromium content that did not
exist before a click?**
*What changes:* whether materialisation is a first-class wait or a sleep with a nicer name.
*Answer requires:* a measured latency and a demonstration that the spike causes its own event.

> **CLOSED — Answered.** A push subscription installed before page script, surviving
> navigation, observed content materialise **253ms** after the click that caused it —
> [can we subscribe to element changes](proofs/can-we-subscribe-to-element-changes.md).
> The polling form was exercised on all 12 runs of the improvement measurement, where a
> failure would have refused the table.
>
> The spike initially reported a **fake pass**: it recorded "did not fire" when nothing had
> happened during its window. It was rewritten to cause its own event and refuse otherwise
> — an unexercised condition reporting success is the vacuous-pass shape this repository
> fears most, and it appeared here first.

**G3 — Can observed effects be recorded from a change stream rather than asserted by the
agent?**
*What changes:* whether the audit record is evidence or testimony.
*Answer requires:* a run whose effects are taken from the surface, not from the plan.

> **CLOSED — Answered.** The interpreter diffs the surface before and after every step and
> records `observedEffects` separately from `intendedEffects`; a plan that claims an effect
> it did not cause, or causes one it did not claim, is visible only because the two lists
> are kept apart. Recorded in
> [what a plan can say without a model](proofs/what-a-plan-can-say-without-a-model.md).
>
> **A rule was killed here.** The earlier formulation — "every effect observed in the page
> must correspond to an audited verb call; an unmatched effect is a divergence event" —
> was measured against a live application and fires constantly during normal use: a human
> typing, a notification, a friend coming online. A tripwire that screams during correct
> operation gets switched off within a week. Replaced by **attribution**: unmatched effects
> are labelled `external`, not flagged. The use is knowing when to yield, not when to
> alarm.

**G4 — Is scroll reachable, and how is discovery-by-scrolling expressed?**
*What changes:* whether "not found" is an answer or an admission of not having looked.
*Answer requires:* a row that is invisible to every route until scrolled, then found.

> **CLOSED — Answered.** Row 40 of a virtualised list: findable before scrolling **no**,
> after scrolling **yes**, with `scroll` executing as an ordinary plan step of class
> `reveal`. Receipt in
> [what a plan can say without a model](proofs/what-a-plan-can-say-without-a-model.md).
>
> The prototype's action list had no scroll method at all, which made this look like a
> missing *capability*. It is a missing *verb*. And the deeper finding is about honesty
> rather than mechanism: the row exists the whole time and is in no tree of any kind — both
> reading routes are equally blind to unrendered content, per
> [which route to the tree is cheaper](proofs/which-route-to-the-tree-is-cheaper.md).
> **Absence is a claim that must be earned by exhausting the reachable space**, not granted
> on the first miss.

**G5 — Can every precondition the mail scenario needs be expressed as a predicate, or does
something require prose?**
*What changes:* the go/no-go on the whole learning loop. A precondition that must be
explained to a language model was never captured, and the workflow learned nothing.
*Answer requires:* an explicit go or no-go, naming the predicate that failed if any did.

> **CLOSED — Answered: GO.** Every precondition in the scenario is a `{role, name, within}`
> predicate a daemon answers yes or no to. **None required prose.** No predicate failed.
>
> The rule is enforced structurally rather than by review: passing a string where a
> predicate belongs throws, so an underspecified plan cannot be written by accident.
> Recorded in [what a plan can say without a model](proofs/what-a-plan-can-say-without-a-model.md).
>
> *Scope of the claim, stated honestly:* this was measured against a fixture with the mail
> scenario's shape, not against live Gmail, for the credential reason in Q03. The go/no-go
> is real for the plan representation; it is not yet a claim about Gmail specifically.

**G6 — Does an injected page-level recorder survive a real application, and what fraction
of effects does it actually observe?**
*What changes:* whether such a layer can be a gate or only an instrument.
*Answer requires:* a count, not an argument.

> **CLOSED — Answered: 5 of 8.** A document-start injected layer observed five of eight
> effect-causing paths. Missed: a `fetch` inside a Worker, a same-process iframe's natives,
> and a trusted click dispatched over the browser protocol. Recorded in
> [what a page-level recorder observes](proofs/what-a-page-level-recorder-observes.md).
>
> **The number is generous on purpose** — the best version of the idea was measured, not a
> strawman. Even so, it settles the question: a layer that misses three of eight paths
> **cannot be a gate**. It is an instrument, and a good one. The fence is the browser
> profile, enforced by Chrome; the gate is the daemon's verbs, out of page-JavaScript's
> reach; this layer is the recorder.
>
> The spike refused to write a coverage number twice before producing one, because a path
> it claimed to test had not actually fired. A coverage number computed over paths that
> did not fire is a lie with a decimal point.

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
2. `scripts/check-docs.mjs` exits 0.
3. Findings are written down where the work will happen — an amended ADR, a new ADR, or
   a correction to an existing document. A finding that lives only in a spike's output is
   not recorded.
4. Any decision invalidated by a finding is **superseded in writing**, not quietly edited.
5. A cold reader — a person, or an agent session with no memory of these conversations —
   can read the documents and begin the skeleton without asking us anything.

**Discipline clause.** No new decision record during this phase unless a finding forces
one. Wanting to write an ADR because we had a good idea is the signal that we have
drifted from converging back to generating.

---

## 6. What M0.5 left open, deliberately

Closing a question is not the same as knowing everything. These are named so that M1
starts with an accurate picture of its own ignorance rather than a false one.

| Open item | Why it was not closed | Where it gets closed |
|---|---|---|
| Live Gmail, end to end | Needs an authenticated session; credentials are not the agent's to hold | Closed in M2.5: [real gmail through the daemon](proofs/real-gmail-through-the-daemon.md), after the operator signed in once by hand |
| Qt's per-process accessibility knob | Qt6 absent from the test machines | Closed in M2.5: measured on minibeast — see Q05's table (`QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1`; the Qt5-era knob is a no-op) |
| Windows and macOS accessibility from Node | Read from platform documentation, never run | M7, and marked *read, not verified* until then |
| The Silero VAD licence conflict | Two sources from the same project disagree | M5, by reading the LICENSE file at a pinned commit |
| Whether a permissively-licensed wake **model** exists | openWakeWord's shipped weights are non-commercial | M5; training a custom phrase may resolve licence and capability together |

**Two design findings arrived as questions during the milestone and are recorded here
rather than as decisions, because neither was forced by a measurement.**

*Affordances in the tree.* When an element is returned, it could carry the actions
available on it and on its ancestors — so a search that finds nothing sees that the
containing list can scroll. Measured: the Linux route **already exposes this** (`Action`
interface, enumerable by name — exercised in
[can Node act on the desktop](proofs/can-node-act-on-the-desktop.md)); the browser route
does **not** expose it on accessibility nodes, but it is derivable in a single call.
The caution is that an affordance is a claim about what is possible, not proof it will
work — a button can advertise a click and be covered by an opaque panel, which
[what hidden actually means](proofs/what-hidden-actually-means.md) measured. A hint for
the planner; never a permission.

*Search boxes beside scrollable lists.* Most lists that load on scroll have a search box,
and pairing them would let the agent narrow instead of scroll. Measured: when the
application declares the relationship it is exact and survives into the tree; a
**proximity heuristic confidently paired an orphan list with an unrelated search box**, so
proximity must not be offered as a hint. And search is the *less* reliable route — a
contact whose display name uses mathematical-bold characters returns nothing for a plain
search while scrolling finds them. **Search narrows; scrolling proves.** An empty search
result is never permission to report absence.

---

## 7. Questions opened after M0.5

Recorded here rather than as decisions, in the format §1 requires: what changes if the
answer goes one way rather than the other, and what answering it would actually take.

**Q21 — Is a "developer mode" a separate product surface, or does it fall out of the
desktop the daemon already drives?**
*Opened 2026-08-16.*

The target user is general — the person at their desk who wants their computer to do
things. But a developer is a plausible and valuable second audience, and the shape Jamie
described is real: talk to the orb, and have actual work happen on an actual project.
File the issue. Fix the bug. Open the pull request. Steer the agents already doing the
work. The orchestrator dispatches to a *coding* agent instead of a desktop one, and the
coding runtime is already built and optimised for exactly that
([Q13](#q13--what-comes-free-precisely), and `mastracode` is a sibling per
[Q12](#q12--is-mastra-cc-a-plugin-a-sibling-package-or-a-fork)).

*What changes:* whether the product grows a second, non-desktop execution path — with its
own tool surface, its own permission model and its own failure modes — or whether the
developer story is simply *the desktop story, aimed at developer applications*.

**The question splits cleanly, and the two halves have very different prices.**

*The half that is free.* Driving developer tooling **through the browser** costs nothing
new. A signed-in session in the assistant's own Chrome profile — its own account, so its
actions are attributable to it and not to the user — is a desktop the daemon already
knows how to read and act on. Moving a card from intake to triage is a press on an
element; talking to a working agent is text into a textbox; filing an issue is a form.
This was proven on real hardware in M2.5 against a live, hand-signed-in Gmail
([real gmail through the daemon](proofs/real-gmail-through-the-daemon.md)), and profile-as-
launch-identity is already decided
([ADR-0038](02-DECISIONS/0038-a-browser-profile-is-a-launch-identity.md)). **This half
requires no new product surface at all. It falls out of finishing the daemon's verb set.**

*The half that is not free.* Git as a subprocess — worktrees, branches, commits, the CLI —
is command execution, and [00-PRODUCT.md](00-PRODUCT.md) §6 non-goal 1 is *not a remote
shell*: the agent never gets arbitrary command execution as a desktop-control primitive.
That ban is not squeamishness about developers; it is the thing that keeps every other
permission meaningful, because a shell is a universal bypass of the element-level model.
Reaching this half means either a genuinely new sandboxed execution surface with its own
consent model, or an exception to the product's first non-goal. Neither is cheap and
neither is currently justified.

*Answer requires:* not research — **evidence from the free half first.** Drive a real
developer workflow end to end through the browser route, on real hardware, the way Gmail
was driven, and see what it actually cannot reach. Only a workflow that provably cannot
be done through an application the daemon can drive is evidence that a second execution
path is needed. Anything less is a second path built on a guess.

> *Jamie's own example is the argument for the cheap half.* He described the assistant
> going to the factory board in its own browser session, moving an issue through triage,
> and talking to the agent doing the work — and none of that needs a shell. It needs a
> browser the daemon can drive and an account of its own.

> *And there is a version of this that is a trap.* The daemon could open an editor and
> type code into it, visibly, like a person. It would be a hell of a demo and a terrible
> way to get work done — impressive rather than useful. If the developer path is taken, it
> is taken because it is faster than doing the work yourself, not because watching it is
> entertaining.

*Blocking:* nothing. The daemon's capability work is upstream of this question and
narrows it. Revisit once the verb set is complete.

**Q22 — Does an always-on-top window actually stay on top?**
*Opened 2026-08-22.*

[ADR-0016](02-DECISIONS/0016-the-face-is-a-managed-window-that-hides-when-told.md) rests on a window
manager honouring `_NET_WM_STATE_ABOVE` for a window it manages, and
[07-ROADMAP.md](07-ROADMAP.md)'s M4 exit gate states the consequence in one line: a
raised full-screen window does not bury the face. The prototype's evidence for that line
came from a face that was override-redirect, which is a window the window manager does
not manage at all — so what it measured was raw stacking order, not the guarantee.

*What changes:* whether the face needs anything beyond `ABOVE` to hold its place. If
`ABOVE` is sufficient, decision 1 is the whole window model. If it is not, the face needs
either a remedy the ADR does not currently name, or the exit gate needs its condition
stated, and a milestone that ticks the box without stating it has ticked a box that is
false in the common case of a user watching a video.

*Answer requires:* not argument — a managed window carrying `ABOVE` on a real X server
with a real EWMH window manager, measured against a real full-screen window with
`xwininfo` and `xprop`, out of band. Answered by
[what the face does on a real desk](proofs/what-the-face-does-on-a-real-desk.md): `ABOVE`
is honoured, and a full-screen window that **holds focus** is promoted above it anyway;
the face returns to the top on its own when focus moves. `_NET_WM_WINDOW_TYPE_DOCK` does
not change it.

*Blocking:* M4's exit gate. The burial condition was first measured during planning, on a
probe window rather than on the face, which is why the exit gate could be written with the
condition already known. The rows in the artifact were then taken again against the built
face — the artifact records the tree it was measured on, and that tree contains the window
model. Both readings agree; the planning one is not evidence for the box, and this line
does not claim it is.

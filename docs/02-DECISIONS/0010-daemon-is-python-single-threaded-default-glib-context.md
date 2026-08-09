# ADR-0010 — The daemon is Python, single-threaded, on the default GLib main context

**Status:** **superseded 2026-08-09 by [ADR-0030](0030-the-daemon-is-one-node-process.md)** — the language choice is dead; the single-thread constraint survives.
**Date:** 2026-08-08

> **What changed.** Linux accessibility is plain D-Bus underneath, and a Node
> implementation matched the Python one on read, write and events
> ([what language each backend wants](../proofs/what-language-each-backend-wants.md)). The
> single-thread rule below is **kept, and its stated failure mode was wrong** — running
> `libatspi` from two or more threads does not silently corrupt data; it aborts the process
> with SIGTRAP, deterministically, on two machines
> ([is the accessibility binding thread-safe](../proofs/is-the-accessibility-binding-thread-safe.md))
> — measured through `libatspi`, which the Node daemon does not load, so that receipt is
> owed again on the new route ([ADR-0030](0030-the-daemon-is-one-node-process.md) clause 3).
>
> **Nothing below is an instruction any more.** Clauses that died with the language are
> struck through in place rather than deleted, so the record still shows what was believed
> and what it cost. Read this file as history; read ADR-0030 for what to build.
**Carried forward from the prototype. Every clause below was paid for.**

> **Scope, corrected.** This record describes **the Linux backend**, not "the daemon" in
> general. The distinction did not exist when it was written because only one platform
> did. See the Amendments section before applying any rule here to Windows or macOS, and
> note that two of its clauses are now open questions rather than settled law.

## Context

The accessibility layer on Linux is AT-SPI2, reached through GObject introspection bindings that are distribution packages rather than wheels. That single fact drives most of this ADR.

The prototype's own notes record what went wrong before these rules were adopted, and they are worth restating because each looks like a preference until you violate it:

**Threading.** AT-SPI2 access from more than one thread produces failures that do not look like threading failures. The rule is a single-threaded event loop, and it is not negotiable.

**Main context.** Registering on a non-default GLib main context caused **silent event loss** — no error, no warning, simply events that never arrived. The prototype's notes record that this cost roughly an hour to find, which is cheap only because it was found at all. A subscription lane that silently drops some events is worse than one that is obviously broken.

**Virtual environment.** The venv must be created with `--system-site-packages`, because the GObject bindings are installed by the distribution and cannot be pip-installed into an isolated environment. The prototype's notes call this mandatory, and a fresh contributor hits it immediately.

**Test isolation.** AT-SPI2 can **abort the interpreter** when the accessibility bus is absent — not raise, abort. This is why the prototype has a `--no-live` test lane: the suite must be runnable on a machine with no display, and the mechanism cannot be a try/except.

**Capability probing.** Reading a settings key to decide whether accessibility is available is not the same as asking the system whether it works. The prototype learned to probe capability directly rather than trust `gsettings`, and the same mistake in a different costume produced issue #194, where a refusal blamed a flag that was demonstrably present.

The counter-argument — write the daemon in a compiled language — was considered and loses on binding maturity. The Python GObject bindings are the well-trodden path for AT-SPI2; anything else means maintaining bindings as well as a product.

## Decision

~~**The daemon is Python.**~~ **Five rules, all enforced by tests or by the setup script, not by memory** — two of which died with the language and are struck below:

1. **One thread.** A single event loop owns all accessibility access. Any work that must happen elsewhere is handed off by queue and never touches an accessibility object.
2. ~~**The default GLib main context.** Registering elsewhere loses events silently. A test asserts the context used at registration.~~ — **dead with the language.** There is no GLib main context in a Node daemon; the rule it encoded, that one owner registers for events, survives in clause 1.
3. ~~**`--system-site-packages`**, created by `infra/apply.sh`, never by a hand-typed `python -m venv`.~~ — **dead with the language.** There is no interpreter and no virtual environment to configure.
4. **Two test lanes.** `--no-live` runs everywhere and is what CI runs. The live lane requires a display and is what proof artifacts run under. A live-only test must be marked, because the alternative is an interpreter abort that looks like a crashed runner.
5. **Capability is probed, never inferred from a settings key.** A refusal cites the probe result. See [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md).

**One additional rule from operational experience:** the daemon's own module layout should keep backends small and separately testable. The prototype's single largest churn source was its server module at 35 revisions, with the AT-SPI backend at 24 — the two files that everything else pushed changes into. Splitting transport, dispatch, scope enforcement, and backend into separate modules from the start is the cheap version of that lesson.

## Amendments

**2026-08-08 — this is the Linux backend, not the daemon.** When this was written the
daemon and its only backend were the same object. They are not any more:
[ADR-0017](0017-platform-backends-live-inside-the-daemon.md) puts a platform seam inside
the daemon, so the rules above apply to what lives *behind* that seam on Linux.

The underlying principle does generalise, in three shapes. Each platform's accessibility
layer has a threading discipline that is not optional: Linux wants the default GLib main
context, Windows UI Automation is apartment-threaded, macOS wants the main run loop. Same
rule, three expressions. The clause here originally added *and it fails quietly rather than
loudly when broken*; that is half refuted — the main-context failure is silent, and the
threading failure measured in M0.5 is a loud abort. Rules 3
and 4 — `--system-site-packages`, and the two test lanes — are Linux-specific
consequences of the bindings being distribution packages, and do not transfer.

Rule 5, capability is probed and never inferred, is **not** platform-specific and applies
everywhere without amendment.

**2026-08-08 — two clauses are now open questions, not settled law.** Both are filed in
[09-QUESTIONS.md](../09-QUESTIONS.md) and either could invalidate part of this record:

- **Q07** asks whether a maintained, permissively licensed TypeScript path to each
  platform's accessibility API exists. "Python" in the title is a consequence of the
  bindings being mature in Python and immature elsewhere. If that premise fails, the
  language choice fails with it — and a native Node addon counts, because it still ships
  as a registry package inside the monorepo, which a separate Python process does not.
- **Q08** asks whether the single-threaded default-main-context requirement is a property
  of the C library or of the AT-SPI protocol underneath it. Accessibility on Linux is a
  message bus protocol; the library is a convenience over it. If the constraint lives in
  the wrapper rather than the wire, rules 1 and 2 are a workaround for a dependency we
  were not obliged to take.

Neither is being acted on yet. They are recorded here so that nobody reads this record as
closed when two of its load-bearing clauses are hypotheses that happen to have been
expensive to learn.

## Consequences

**Good.** The bindings are the mature path, the failure modes are known and written down, and a contributor who reads this document avoids all five of the traps that cost the prototype real time.

**Cost.** Python in a performance-sensitive event path. The prototype did not hit a throughput wall in seven days of use, so this is a watch item rather than a known problem — and if it becomes one, the fix is to narrow what happens on the event thread, not to change language.

**Cost.** `--system-site-packages` means the daemon's environment is not fully hermetic. Accepted: the alternative is not available.

## Evidence

| Claim | Source |
|---|---|
| single-thread loop rule | prototype `docs/08-prototype-notes.md` |
| default GLib context, silent event loss, ~1 hour lost | prototype `docs/08-prototype-notes.md` |
| `--system-site-packages` mandatory | prototype `docs/08-prototype-notes.md`; also the sandbox setup command |
| AT-SPI2 can abort the interpreter without a bus; `--no-live` lane rationale | prototype `docs/08-prototype-notes.md` |
| capability probing beats reading `gsettings` | prototype `docs/08-prototype-notes.md` |
| refusal blamed a present flag | issue #194 |
| `server.py` 35 revisions, `backends/atspi.py` 24 | `git log` counts |
| suite size at pivot: 1,126 passed / 57 skipped | full python run, 2026-08-07 18:33 |

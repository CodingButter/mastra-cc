# 0030 — The daemon is one Node process, and Linux does not need Python

**Status:** accepted, 2026-08-09.
**Supersedes:** [ADR-0010](0010-daemon-is-python-single-threaded-default-glib-context.md).
That record's constraint survives; its language choice does not.
**Forced by:** the measurements in
[what language each backend wants](../proofs/what-language-each-backend-wants.md),
closing Q07 and Q08 in [09-QUESTIONS.md](../09-QUESTIONS.md).

## Context

ADR-0010 chose Python for the daemon and required a single thread on the default GLib main
context. Both halves were hard-won: the wrong main context loses events silently, and that
had actually happened.

The language half rested on a premise nobody had tested — that reaching Linux
accessibility means using the C library, and the C library means Python. Q07 asked whether
a permissively licensed TypeScript route exists; Q08 asked whether the single-thread
constraint belongs to the library or to the protocol. The second question is the one that
mattered, because if the constraint lives in the wire then no implementation escapes it and
the language question is moot.

**Accessibility on Linux is plain D-Bus underneath.** The Python binding is a convenience,
not a gate. A direct-to-bus implementation in Node was measured against the Python route on
the same live desktop and matched it:

| Capability | Result |
|---|---|
| Enumerate applications | 18 found by Node, 18 by the Python control — identical |
| Walk and read | 400 nodes walked, roles and states readable on every one |
| Write | text inserted and verified by reading it back; an action invoked by name with its effect measured on the tree |
| Events | 6 signals attributable to a specific cause, 138ms from cause to signal |

The single-thread constraint is real and turned out to be **a property of the library, not
the wire** — demonstrated by a non-GLib implementation working without any GLib main
context, which is exactly the evidence Q08 demanded and refused to accept an argument in
place of.

The prototype's stated failure mode was also wrong, in a way worth recording. Its source
claimed concurrent use causes *silent data corruption*. Measured: two or more concurrent
threads **abort the process** with SIGTRAP, deterministically, over 8 consecutive runs and
reproduced on a second machine with a different session type and a different Node version.
It is a loud crash, not silent corruption.

## Decision

**One process. One language. Node.**

1. **The Linux backend speaks D-Bus directly** — no Python, no native addon, no
   introspection library. There is no Python sidecar and therefore no cross-language seam
   to maintain forever.
2. **The Chromium backend is Node too**, over the browser protocol, using the runtime's
   built-in WebSocket with **no dependency at all**. It covers Chrome and every Electron
   application, from one implementation. The protocol itself is not platform-specific, so
   this is expected to hold on Windows and macOS — **expected, not measured.** Every
   receipt below was taken on Linux, and clause 4 applies to this claim as much as to the
   accessibility one.
3. **The single-threaded requirement survives**, for a better reason than it was given.
   Concurrency against the accessibility layer is not a corruption risk to mitigate — it is
   a deterministic process abort. Serialise, and the failure cannot occur.
4. **Windows and macOS are unresolved and marked as such.** UI Automation is a COM API and
   the macOS Accessibility API is Objective-C; both are reachable from Node through a
   native addon, and **neither has been run**. They are recorded as read-not-verified. This
   record does not extend its Linux conclusion to them by analogy, because assuming one
   platform's answer holds for another is precisely the mistake ADR-0010 made.
5. **Dependency choices carry a licence and a maintenance signal, separately.** Read from
   the LICENSE file, never from a metadata field: for two of the candidates below, GitHub's
   own API reports `NOASSERTION` for projects that are genuinely MIT.

   | Candidate | Licence | Maintenance |
   |---|---|---|
   | `dbus-native` (sidorares) | MIT | last commit 2026-08-02, last publish 2026-07-30, 10 open issues |
   | `@homebridge/dbus-native` | MIT | last commit 2026-07-25, 0 open issues |
   | `dbus-next` | MIT | **abandoned** — last commit 2022, 51 open issues |

## Consequences

**The cost.** We give up a mature, widely used binding for a direct protocol
implementation, which means the vocabulary and quirks of the accessibility protocol become
ours to handle. One is already known: role names differ between bindings for the same node,
so the neutral vocabulary map in
[ADR-0018](0018-the-protocol-speaks-a-neutral-element-vocabulary.md) must key on the
**binding's** vocabulary and not only on the platform's. A mismatch there masquerades
convincingly as a missing node — it did during the spike, and it cost real time before the
cause was found.

We also give up Python's accessibility ecosystem as a reference implementation to compare
against at runtime. It stays available as a debugging control, which is how the divergence
above was caught.

In exchange: one process, one language, one build, one dependency story. No inter-process
protocol between two halves of the daemon, and no seam that has to be versioned. The
Chromium backend needs no per-platform work at all.

**A constraint that follows from this and the browser work together.** Both routes need the
same thing — the application must be launched with the right conditions — which is one
policy rather than two. That is
[ADR-0027](0027-the-assistant-opens-the-application-itself.md).

## Evidence

- [what language each backend wants](../proofs/what-language-each-backend-wants.md) — the
  ruling per backend, each row with the command that produced it.
- [can Node read the accessibility tree](../proofs/can-node-read-the-accessibility-tree.md)
  — 18 applications matching the Python control exactly, 400 nodes walked.
- [can Node act on the desktop](../proofs/can-node-act-on-the-desktop.md) — text inserted
  and verified, action invoked, effect measured on the tree rather than taken from a return
  value. A write reported success while a naive full-range read returned empty; the write
  had landed and the *verification* was broken. This is why writes need their own verdict.
- [can Node be told the desktop changed](../proofs/can-node-be-told-the-desktop-changed.md)
  — 6 attributable events at 138ms. Of 639 signals received during the window, only 6 were
  caused by us; an idle desktop emits 18 signals in a quiet 3-second window. Passive listening
  would have "proved" subscription using ambient chatter.
- [is the accessibility binding thread-safe](../proofs/is-the-accessibility-binding-thread-safe.md)
  — deterministic SIGTRAP abort at two or more threads, 8 runs, reproduced on a second
  machine across different session types and runtime versions. A threading claim resting on
  one machine is one machine's claim.

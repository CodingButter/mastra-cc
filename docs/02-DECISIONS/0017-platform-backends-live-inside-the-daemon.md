# ADR-0017 — Platform backends live inside the daemon

**Status:** accepted
**Date:** 2026-08-08
**Amends the scope of [ADR-0010](0010-daemon-is-python-single-threaded-default-glib-context.md).**
**Forward decision, not back-filled.** The prototype was Linux-only and produced no evidence about other platforms. What the prototype does supply is the shape this decision relies on: a frozen wire protocol and a daemon that is the only accessibility consumer. Claims about Windows and macOS below are stated as design reasoning and are marked as such.

## Context

The prototype targeted one desktop: Ubuntu, GNOME, X11, AT-SPI2. A Windows port existed only as a deferred issue (prototype #16), scheduled after shipping.

Jamie's direction on the rebuild (2026-08-08) is that all platforms are in scope from the beginning — not implemented from the beginning, but *designed for* from the beginning, behind an extensible interface. That is a different requirement from "port it later", and the difference is structural: a port is cheap if the seam already exists and expensive if it has to be cut through working code.

Two facts make this cheap to do now:

1. **The protocol is already the cross-platform interface.** The hub and every client speak JSON-RPC over a socket ([01-ARCHITECTURE.md §1](../01-ARCHITECTURE.md)). Nothing above the daemon knows what an accessibility tree is, let alone which one. The seam does not need to be invented — it needs to be *respected*, and the thing that respects it is [ADR-0018](0018-the-protocol-speaks-a-neutral-element-vocabulary.md).
2. **[ADR-0010](0010-daemon-is-python-single-threaded-default-glib-context.md) already asks for small, separately testable backends.** Its closing rule — split transport, dispatch, scope enforcement, and backend into separate modules — was written from churn data (`server.py` at 35 revisions, `backends/atspi.py` at 24). That rule was about maintainability. It happens to also be the port seam.

The one thing that must be corrected is the *scope* of ADR-0010. It reads as five rules about "the daemon". Three of them are not facts about the daemon at all — they are facts about the Linux backend:

| ADR-0010 rule | Actually scoped to |
|---|---|
| One thread | the Linux backend (AT-SPI2's constraint) |
| The default GLib main context | the Linux backend (GLib does not exist elsewhere) |
| `--system-site-packages` | the Linux backend (distribution-packaged GObject bindings) |
| Two test lanes (`--no-live` / live) | **the daemon** — every platform needs it |
| Capability is probed, never inferred | **the daemon** — every platform needs it |

Left uncorrected, a Windows backend author reads "one thread, default GLib context" as a house rule and either obeys it meaninglessly or ignores the whole record. Design reasoning, not measurement: Windows UI Automation is a COM API with apartment-threading rules of its own, and macOS accessibility expects the main run loop — so the *shape* of the threading rule differs per platform even though the *principle* (one owner for accessibility access, established explicitly) does not.

**Language.** ~~Python survives all three platforms — GObject introspection on Linux, COM interop on Windows, the Objective-C bridge on macOS all have established Python bindings.~~ **Superseded by [ADR-0030](0030-the-daemon-is-one-node-process.md).** The reasoning above was sound and its premise was wrong: it assumed a language must have an accessibility *binding* to reach the platform. Linux needed none — the accessibility layer is plain D-Bus underneath and Node reached read, write and events directly. The daemon is Node. Windows and macOS remain **undecided and unmeasured**, which is the honest state and the one this record's own rule demands.

**What each backend implements, and what that does not prove.** The seam is a small capability surface — find elements, read one, act on one, subscribe to changes — and each platform satisfies it however its own API wants: a bus on Linux, a COM API on Windows, an Objective-C framework on macOS, a debugging protocol for Chromium. It is deliberately *not* modelled as "a bus", because only one of the four is one.

An interface proves every backend has the methods. It proves nothing about whether they work: a backend can implement all four, return empty lists forever, and compile perfectly. **The contract is therefore a shared conformance suite, not the interface** — one set of tests every backend passes on real hardware. A platform is finished when it passes, not when it builds.

**And the suite must not assume the backends can know the same things.** Measured, not supposed: asked whether a person can actually see an element, the browser route answered correctly on 10 of 10 cases and the platform route on 6 — it cannot detect a fully transparent element, and its hit test does not report occlusion by a non-accessible panel ([what hidden actually means](../proofs/what-hidden-actually-means.md)). If both return a bare boolean, the daemon reports a confident falsehood on one platform. So a verdict **carries the route that produced it**, and a backend that cannot determine something says so rather than guessing. This is ADR-0010's surviving rule 5 — capability is probed, never inferred — applied to the interface itself.

## Decision

1. **The platform seam is inside the daemon, and nowhere else.** One backend module per platform, behind one internal interface. The hub, the clients, and the protocol are platform-agnostic and stay that way.
2. **[ADR-0010](0010-daemon-is-python-single-threaded-default-glib-context.md) is re-scoped, not superseded.** Its threading, main-context, and venv rules are rules of the **Linux backend**. Its two-lane testing rule and its capability-probing rule are rules of **the daemon**. ~~Its language choice stands.~~ — **its language choice does not stand; see the struck paragraph above and [ADR-0030](0030-the-daemon-is-one-node-process.md).** The re-scoping in this record survives the language change intact, because it was always about which rules belong to a backend and which to the daemon.
3. **Each backend declares its own concurrency contract** in its module, with the reason. "One thread on the default GLib main context" is the Linux backend's answer to a general question — *who owns accessibility access, and on what* — that every backend must answer explicitly rather than inherit.
4. **Each backend owns its own role mapping** from native vocabulary to the protocol's neutral vocabulary. See [ADR-0018](0018-the-protocol-speaks-a-neutral-element-vocabulary.md).
5. **Each backend owns its own capability remediation** — what has to be arranged on that platform before an application can be read. See [ADR-0020](0020-granting-an-application-is-a-transaction-with-a-rollback.md).
6. **Only Linux is implemented before M6.** This ADR buys the seam, not the ports. A second backend written before the north star sentence works would be exactly the parallel-work-against-a-moving-shape failure that [ADR-0015](0015-one-vertical-slice-before-parallel-agents.md) exists to prevent.

## Consequences

**Good.** The expensive half of a port — the protocol, the permission model, the audit log, the consent surfaces, the hub, every client — is written once and is platform-independent by construction. What remains per platform is a backend module and a role table.

**Good.** It forces the neutral vocabulary question ([ADR-0018](0018-the-protocol-speaks-a-neutral-element-vocabulary.md)) to be answered at commit one, when it costs a design conversation, rather than at the first port, when it costs a protocol version bump.

**Cost.** A single-backend system with a backend interface has an abstraction with exactly one implementor, which is normally an anti-pattern and is normally worth deleting. Accepted deliberately, and the deliberation is the point: the seam is being bought before it is needed because the whole rebuild exists because the prototype bought its seams too late.

**Cost.** The interface will be wrong in places, because it is being designed against one platform's behaviour and reasoning about two others. The mitigation is that it is *internal to the daemon* — changing it costs a refactor, not a protocol change. That containment is the actual deliverable of this ADR.

**Cost, and this one is real.** There is a temptation to validate the seam by writing a second backend early. Do not. The seam is validated by M6 working on Linux with the vocabulary rule enforced; a second backend before then buys a moving target.

## Evidence

| Claim | Source |
|---|---|
| prototype was Linux/GNOME/X11/AT-SPI2 only | [ADR-0010](0010-daemon-is-python-single-threaded-default-glib-context.md) Context |
| Windows port existed only as a deferred issue | prototype issue #16; [07-ROADMAP.md](../07-ROADMAP.md) "Deliberately not scheduled" |
| all platforms in scope from the beginning | Jamie, 2026-08-08, rebuild design conversation |
| nothing above the daemon touches accessibility | boundary B1, [01-ARCHITECTURE.md §5](../01-ARCHITECTURE.md) |
| ADR-0010 already asks for small separable backends | [ADR-0010](0010-daemon-is-python-single-threaded-default-glib-context.md), closing rule |
| `server.py` 35 revisions, `backends/atspi.py` 24 | prototype `git log` counts |
| Windows UIA threading, macOS run-loop expectations, Python binding availability on all three | design reasoning from published platform API behaviour; **not measured by us** — verify before the first non-Linux backend |
| one vertical slice before parallel work | [ADR-0015](0015-one-vertical-slice-before-parallel-agents.md) |

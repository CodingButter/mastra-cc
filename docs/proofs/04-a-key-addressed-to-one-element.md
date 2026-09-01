# A key, addressed to one element — and a machine that cannot press one

**What was claimed:** an agent can be granted the authority to send one named key chord to one
element it names, that authority is off until a person turns it on, and it can never be reached as a
fallback from a semantic verb that was refused.

**What was proven, on a real KDE desktop, driven through the wire:** all of that — and one thing
more that was not expected. This machine cannot deliver a key at all, and the daemon now says so
in the wire's own words rather than pressing into the void.

Harness: `infra/webtop/04-a-key-addressed-to-one-element/proof.sh`.
Transcripts: [without](04-a-key-addressed-to-one-element-without.txt) (base `2593e80`),
[with](04-a-key-addressed-to-one-element-with.txt).

## The errand

Errand E2 of the desktop-literacy sweep — rename a file in the file manager — scored 0/3 before the
agent instructions were rewritten and 0/3 after (`docs/proofs/errands/`). The diagnosis was never
prose: the inline rename commits on Enter, and the daemon had no Enter. This is that errand, run
against three daemons.

| daemon | asked to press F2 on the file | file on disk afterwards |
|---|---|---|
| base `2593e80` | no such route on the wire | `notes.txt`, untouched |
| this branch, unarmed | refused: *"is rawInput-class and this session holds no rawInput authority … this session was started without the session flag `--allow rawInput`"* | `notes.txt`, untouched |
| this branch, `--allow rawInput` | refused: *"cannot be performed by this build on this platform — there is no way to deliver a key here, and no setting on this daemon would change that"* | `notes.txt`, untouched |

The middle row is the segment's central claim, measured against a running daemon rather than read off
the source: **off by default, and the refusal names the flag that would change it.** The bottom row is
the discovery.

## The discovery: the interface accepts a key and delivers nothing

Phase 1 measured `DeviceEventController.GenerateKeyboardEvent` carrying a printable keysym into a
focused editor, and the design was built on it. Driving the errand showed the rest:

| emitted | target | result |
|---|---|---|
| `SYM` `0x062` (`b`) | focused Kate text | arrived (Phase 1) |
| `SYM` `0xff0d` (Enter) | Kate document reading `"one"` | still `"one"` |
| Backspace, Escape, Delete | same | still `"alpha"` / `"one"` |
| `Control+a`, `Control+x` | same | no change |
| ArrowUp/Down, F2 — as `SYM`, and as keycode press+release | file manager, confirmed X-active | selection never moved |
| **a plain XTest key, same window, same second** | same | **selection moved immediately** |

Every failed emission returned success. The last row is the control: the display server accepts
synthetic keys and the application obeys them, so this is not focus, not the window manager and not
the application — the accessibility device controller takes a non-printable keysym and drops it.

This refutes risk R1, which the plan carried forward unresolved and whose disposition was to stop
rather than redesign. Making a chord land needs a different mechanism underneath — XTest directly, or
the kernel input device — which is a new synthetic-input class, a design decision, and a question
against the human-simulation rule. It is not smuggled in here.

## What shipped instead

A route that carries no chord in the contract's vocabulary is not a route, so no platform in this
build claims one. The capability reports `not-exposed` — the wire's word for *"the element never
offered it, and no setting would change that"* (`protocol/schema.json:236`) — and the proof asserts
the refusal is **not** phrased as configuration: an operator must not be sent hunting for a flag that
would not help.

Everything above that seam stands and is enforced: schema 1.11.0's closed 21-chord vocabulary,
`sendKeyChord` dispatched `rawInput`-class with before-call enforcement, separate audit attribution,
the prohibition on reaching key delivery from a refused semantic verb, and the focus-restoration
report. Pin B8's containment home is empty again, which is its strictest reading: with nothing
delivering a key, a raw-input tool may appear nowhere in the product at all. The day a delivering
route is written, its directory is listed there in that diff.

The honest summary is that this segment shipped the authority for a key, the vocabulary for a key,
and the truth that this desk will not take one.

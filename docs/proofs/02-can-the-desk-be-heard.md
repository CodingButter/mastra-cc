# Can the desk be heard? — a deaf machine, measured on a real desktop

**Produced by:** `bash infra/webtop/02-can-the-desk-be-heard/proof.sh`
**Date:** 2026-09-01 · **Base:** `6055f1a` (segment 01's tip) · **Model:** `google/gemini-2.5-flash`
**Transcripts:** [red](02-can-the-desk-be-heard-without.txt) · [green](02-can-the-desk-be-heard-with.txt)

## The question

A machine whose accessibility layer is switched off answers every query with nothing at all. So
does a machine with an empty desktop. The daemon could not tell those two apart, and neither
could an agent reading its results — the silence had no explanation attached, and an agent that
reads silence as absence forms a false belief about a desk that is in fact full of windows.

## The errand

The harness switches `org.a11y.Status.IsEnabled` to false over the container's own session bus and
starts the daemon against a genuinely deaf desk. The model is asked one question with three honest
answers — `WINDOWS`, `DEAF`, or `EMPTY` — and the daemon's own report is read out of band beside
it, so the verdict is the daemon's and the model's word merely has to agree.

Then the operator's route runs: a daemon started with `--acquire-accessibility` is asked to switch
the layer on, and the state that comes back is re-read from the layer rather than asserted from
the attempt. The agent is not in that beat at all — the flag is a command-line fact it cannot reach.

Each side runs the client its own commit ships (packed tarballs, separate scratch projects), because
this change moves the schema 1.7.0 → 1.8.0 and the handshake refuses a mismatched digest.

## What happened

| | base `6055f1a` | this branch |
|---|---|---|
| `describeAccessibility` | route absent | `disabled` → **`enabled`** |
| `acquireAccessibility` | route absent | acquired, re-read as `enabled` |
| the model's one word | `DEAF` | `DEAF` |
| tool calls | 1 | 1 |

Both models said `DEAF`, and that is the interesting part rather than a tie. **The base model was
guessing.** Its stated reason — quoted in the red transcript — is that the grants file disables
observation, which is not true of that run: it was given `--grant '*'`. It reached the right word
through a fabricated cause, which is the failure mode of a surface that reports silence without
reporting why. The branch model called `describeAccessibility` once and said the layer is switched
off, because the desk told it so.

## What this run also taught the harness

The container has **two** session buses, each with its own `org.a11y.Status`. The first attempt
deafened one and measured the other, and the daemon truthfully reported `enabled` on a desk the
harness believed it had switched off. Every status object that answers is now switched together —
recorded here because a proof that deafens the wrong bus looks exactly like a daemon that lies.

The switch-off is undone from a `trap … EXIT` handler installed before the first switch, since
segments 03 and 04 drive the same container: `IsEnabled` reads `true` on both buses after the run.

## The bounds of this

One platform. Linux, AT-SPI, `org.a11y.Status` — the seam is platform-neutral and the second adapter
is not written, so nothing here proves the shape survives contact with a second desktop. And the
acquire path proves an operator can switch the layer on; it does not prove the layer coming on makes
a previously deaf application readable, which depends on that application's own toolkit having been
started with accessibility available to it.

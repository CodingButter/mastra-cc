# ADR-0004 — Semantic first; pixels are a last resort, addressed by window

**Status:** accepted; one clause amended by [ADR-0046](0046-raw-input-is-the-most-restricted-class-not-a-banned-one.md) (2026-08-17)
**Date:** 2026-08-08
**Carried forward from the prototype unchanged.** This is the founding bet and it held.

> **Amendment, 2026-08-17.** The semantic-first decision stands in full. The outright ban on raw input synthesis in *Decision* below is replaced by [ADR-0046](0046-raw-input-is-the-most-restricted-class-not-a-banned-one.md): raw input becomes the most restricted operation class — off by default, never self-granted by an agent, never reachable as a fallback from a semantic failure, always attributed as its own class, and enabled only by a decision the user makes. The reasoning at `:43` — that the ban existed to make the shortcut a *visible act* — is preserved as the cost this amendment knowingly pays, and B8 becomes a containment test rather than an absence test. Addressed capture (`:33`) and the pixels-are-never-resolution rule are untouched.

## Context

There are three ways to drive somebody else's desktop:

1. **Pixels.** Screenshot, ask a vision model where to click, synthesise a click.
2. **Raw input.** Drive `xdotool` / `uinput` against coordinates or key sequences.
3. **Semantics.** Read the accessibility tree — the same structure a screen reader consumes — and act on named objects with roles and states.

The prototype chose (3) on day one, banned (2) outright, and constrained (1) to a narrow, addressed role. Seven days of evidence across GTK3, GTK4, Qt, and Electron applications did not produce a reason to revisit it.

What the semantic path bought, concretely:

- **Attribution.** A change can be reported as caused by the agent or as `external` — a human did it. There is no pixel-level equivalent, and the entire "a human at the keyboard outranks the agent" rule (issue #25) rests on it.
- **Honest failure.** When Chromium's accessibility layer is unreadable, the system reports the browser as *running but unreadable* rather than absent (`6657915`). A vision agent cannot make that distinction; it sees a window either way and guesses.
- **Provable action.** Keystrokes can be shown to have reached a field that had no other way in (proof artifact `keystrokes-reach-a-field-with-no-way-in.md`). Deletion can be told apart from insertion, and both attributed (issue #11 / #26).
- **Toolkit truth.** Measurement, not assumption: GTK4 exposes frame actions where Qt exposes widget actions, which is the kind of fact that only surfaces when you ask the object what it can do.

What it cost: applications with poor accessibility support are genuinely harder, and some are impossible. The prototype's answer was to say so — the security document has a section titled *"What this model does NOT guarantee"* — rather than to paper over gaps with pixels.

## Decision

**Resolution is always semantic. Pixels are a capture of a window you already resolved semantically, never a way to find something. Raw input synthesis is banned.**

Concretely:

- ~~**Banned everywhere, enforced by boundary test B8:** `xdotool`, `wmctrl`, `uinput`, and any equivalent raw-input path.~~ — **struck 2026-08-17 by [ADR-0046](0046-raw-input-is-the-most-restricted-class-not-a-banned-one.md).** The reason is preserved: the ban made the shortcut a visible act. It is replaced by containment, not by permission — raw input is the most restricted operation class, off by default, never self-granted, never reachable as a fallback, and B8 now asserts the tools appear *only* inside that class.
- **Capture is addressed.** A screenshot is taken *of a named window or element* that was resolved through the tree. It is never a full-desktop grab handed to a model to search. The prototype's element-scoped capture work (issue #197) and window-addressed capture (`08-01 12:22`) are the shape.
- **Vision is a deferred tier**, listed in the deferred set with app-native integration and compositor access — not a fallback that quietly becomes the primary path when the tree is inconvenient.
- **When the tree cannot answer, the system says so.** A refusal names the check that produced it (see [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md)). It does not fall back to guessing.

## Consequences

**Good.** Attribution, honest refusal, provable action, and a security model that can actually be reasoned about. The architecture also inherits a physical advantage: a semantic agent runs on the desk that already exists, with the person's session and credentials already loaded, rather than needing a machine to look at.

**Cost.** Coverage gaps on badly-behaved applications, permanently. Some of those are fixable by curing the application's accessibility exposure — the prototype did exactly this for Chromium, via desktop-entry overrides and `--force-renderer-accessibility`, and explicitly rejected requiring a screen reader to be running as a precondition.

**Risk.** Under deadline pressure, "just screenshot it" is always the shortest path. B8 and the addressed-capture rule exist so that taking it requires deleting a test, which is a visible act.

## Evidence

| Claim | Source |
|---|---|
| semantic model established day one | `08-01 03:37`, semantic element model + stability registry |
| pixels as last resort, addressed by window | `08-01 12:22` |
| raw input banned | standing project rule; no `xdotool`/`wmctrl`/`uinput` in the tree |
| browser unreadable ≠ absent | `6657915`, 2026-08-04 10:31 |
| human outranks agent | issue #25 |
| keystroke proof artifact | `docs/proofs/keystrokes-reach-a-field-with-no-way-in.md` |
| deletion told apart from insertion, both attributed | issue #11 / #26 acceptance criteria |
| GTK4 frame actions vs Qt widget actions | prototype `docs/08-prototype-notes.md` |
| Chromium curing via desktop overrides, screen reader rejected | issue #115, closed by PR #144 |
| deferred tiers include vision | prototype `docs/07-open-questions.md` |

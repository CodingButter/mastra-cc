# Cold-agent benchmark — the daemon-core completion gate (host-only run)

> **Host-only.** This run was on the minibeast host (GNOME on Wayland), not in the Webtop container, and its web tasks used the headless CDP route. For the Webtop run over the accessibility route (29/30, 0 daemon refusals), see [webtop/README.md](webtop/README.md).

**Verdict: gate met.** In 25 cold runs there were **0 refusals of class `daemon`**. Every failed run can be traced to `world` or `agent` refusals, or to the agent running out of turns.

- **Model:** `google/gemini-3.8-flash`, run through the `@mastra-cc/desktop` demo client.
- **Harness:** `bench.mjs`.
- **Limits per run:** 30 steps and 5 minutes.
- **Code under test:** the daemon at `master` after PRs #127–#138.
- **Grants:** `edit`, `activate`, `submit` and `rawInput`, the same as `apps/desk-demo/desk-up.sh`.
- **Scoring:** each outcome is checked outside the daemon.
  - Mousepad text is checked with a separate AT-SPI reader (`read-text.py`).
  - Files are checked against names the harness created.
  - Settings is checked against `/etc/os-release`.
  - Web tasks are checked against the fixture server's received state.
- **Retries:** provider rate-limit refusals (HTTP 429/402, `RESOURCE_EXHAUSTED`) are retried by the harness and are not scored.

The raw data is in `bench-final.jsonl` (every tool call, the result of each (truncated), and the refusals of each run) and in `bench-final.log`.

## Results

| Task | Pass | Mean turns | Mean tokens | agent | world | daemon |
|---|---|---|---|---|---|---|
| mousepad | 5/5 | 5.0 | 364,524 | 0 | 0 | 0 |
| settings | 0/5 | 30.0 | 2,010,448 | 1 | 23 | 0 |
| files | 5/5 | 7.2 | 376,073 | 0 | 2 | 0 |
| form | 0/5 | 30.0 | 807,567 | 11 | 28 | 0 |
| react | 0/5 | 30.0 | 781,323 | 11 | 47 | 0 |
| **All** | **10/25** | | 21,699,675 total | 23 | 100 | **0** |

| Refusal (class/code) | Count |
|---|---|
| world/EffectUnsupportedError | 53 |
| world/UnperformableElementError | 21 |
| agent/UnpublishedActionError | 11 |
| world/InventoryUnsupported | 10 |
| agent/OperationNotExposedError | 10 |
| world/AttestationFailedError | 10 |
| world/WriteNotObservedError | 5 |
| agent/MagnitudeOutOfRangeError | 1 |
| agent/MalformedParameter | 1 |
| world/LaunchUnavailable | 1 |

## Why each failure happened

- **Settings (0/5).** The agent used all 30 turns. GTK4 GNOME Settings refuses `ScrollTo` and `GrabFocus` (`NotSupported`). On Wayland, screen capture fails with an X `BadMatch`. Scrollbar writes read back as different values (`WriteNotObservedError`). The daemon reports all of these truthfully as `world`: the application or platform declined. The answer was never found within the budget.
- **Form and React (0/5 each).** The CDP route publishes only grounded actions: `focus`, `expand`, `collapse` and `select`. `submitElement` works only on real submit controls (D4). The route has no pointer, keyboard or screen, so `clickElement`, `sendKeyChord`, `typeText` and `captureElement` are refused with `world/EffectUnsupportedError`. As a result the agent could fill text fields but could not tick a checkbox or press a non-submit button. It also repeatedly asked for actions that are not published (`agent/UnpublishedActionError`, `agent/OperationNotExposedError`).
- **Mousepad and Files (10/10)** pass in 5–8 turns.

## What this does and does not show

It shows that the daemon core is truthful. Every refusal names its owner, and none comes from the daemon's own machinery. Earlier batches found D1–D5, which were fixed in PR #138.

It does **not** show that web tasks can be done. The 0/10 web result is a *capability* gap: the CDP route has no grounded way to toggle or click. It is not a daemon fault. Closing it needs a new capability, such as grounded CDP click/toggle or element-anchored pixel fallback (ADR-0112), and that is feature work outside the core plan. Likewise, Settings needs input that works under Wayland.

Earlier batches are kept for history: `bench-norawinput.*`, `bench-quota-killed.*`, `bench-credits-depleted.*`, `bench-provider-refused.jsonl` and `bench-full.*`.

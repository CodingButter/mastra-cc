# Cold-agent benchmark in KDE Webtop, over the accessibility route

**Result: 29/30 runs pass, with 0 refusals of class `daemon`.**

Every run executed inside the pinned KDE Webtop container (`infra/webtop`). Web tasks drove a **visible** Chromium through the daemon's AT-SPI route, the desktop accessibility bus. They did not use the browser debugging route.

- **Model:** `google/gemini-3.8-flash`.
- **Harness:** `../bench-webtop.mjs`.
- **Limits per run:** 30 steps and 5 minutes.
- **Grants:** `edit`, `activate`, `submit` and `rawInput`. Chromium is granted by its executable, `/usr/lib/chromium/chromium` (ADR-0120).
- **Chromium flags:** `--no-sandbox --no-first-run --force-renderer-accessibility`.
- **Scoring:** each outcome is checked outside the daemon.
  - Kate text is checked with a separate AT-SPI reader.
  - Dolphin files are checked against names the harness created.
  - Settings is checked against `/etc/os-release`, case-insensitively. `kinfocenter` is installed first so that "About this System" exists.
  - Web tasks are checked against the state the fixture server received.
- **Provider refusals:** 8 attempts were refused by the provider (quota or overload). They were retried and not scored; they are listed in `bench-webtop-a11y-provider-refused.jsonl`.

The raw data is in `bench-webtop-a11y.jsonl`, which holds every tool call, a truncated copy of each result, and the refusals of each run. The run log is `bench-webtop-a11y.log`.

## Results

The table was computed from `bench-webtop-a11y.jsonl` with `jq`.

| Task | Pass | Mean steps | Mean tokens | agent | world | daemon |
|---|---|---|---|---|---|---|
| kate | 5/5 | 12.0 | 1,128,591 | 0 | 2 | 0 |
| settings | 5/5 | 11.2 | 719,904 | 1 | 2 | 0 |
| files (Dolphin) | 5/5 | 4.6 | 254,333 | 0 | 0 | 0 |
| form | 5/5 | 20.0 | 1,775,951 | 0 | 0 | 0 |
| react | 5/5 | 18.0 | 1,419,342 | 0 | 1 | 0 |
| bad page | 4/5 | 20.2 | 2,104,803 | 0 | 9 | 0 |
| **All** | **29/30** | | 37,014,638 total | 1 | 14 | **0** |

| Refusal (class/code) | Count |
|---|---|
| world/UnperformableElementError (`screen grab failed: X Error … BadMatch`) | 13 |
| world/ElementGone | 1 |
| agent/OperationNotExposedError | 1 |

## Attribution

- **All 13 `UnperformableElementError` refusals** came from `captureElement`. The X server in the container refuses the screen grab with `BadMatch`. This is the platform declining, and PR #138 (D1) maps it to `world`. No run needed a screenshot to succeed.
- **`ElementGone`** (bad#2): the agent used an element id after the page had redrawn. This is `world`, and the run still passed.
- **`OperationNotExposedError`** (settings#1): the agent asked to set the text of an element that does not publish editing. This is `agent`, and the run still passed.
- **bad#4, FAIL: the agent ran out of steps, and there is no daemon refusal.** In 30 steps it made:
  - 4 attempts at `captureElement` / `attestElement`, which led to its 3 world `BadMatch` refusals;
  - 11 `queryElements` calls, plus `discoverElements` and `describeDesktop`;
  - repeated `readElementContent` calls.

  Its last calls typed "Grace" and read it back (the daemon observed `Grace`). The step budget ended before it pressed "Send it" or "Subscribe", so the fixture server received nothing (`observed=null`). **The failure belongs to the agent's pacing within the budget, not to the page or the route.** The other four bad-page runs drove the same controls successfully.

## The bad page

`../fixtures/bad.html` has three deliberately poor controls:

- **A clickable `div` "Send it".** Chromium publishes it as a section with `click`, and its text as a text node with `clickAncestor`.
- **A roleless `span` "☐ Subscribe" checkbox.** It is published the same way.
- **Two unlabelled inputs.** They are published as `textbox`, one named by its placeholder.

In 4 of 5 runs the agent operated all three kinds of control. The model-free proof `route-probe.txt` shows the fake checkbox toggling (`☐` → `☑`), confirmed over a separate debugging-port read and the fixture's POST log. The accessibility route handled this page without any daemon change. What made it work is that Chromium derives clickable ancestry even when a page's semantics are poor.

## What this does and does not show

It shows that inside Webtop, with visible Chromium over AT-SPI, a cold agent completes every task family, and that every refusal names an owner outside the daemon.

It does not show:

- that the CDP (browser debugging) route can click. By design it cannot (ADR-0043/0045).
- anything about GNOME/Wayland hosts. For those, see the host-only run in `../README.md`.

## Earlier runs (kept, labelled)

- `headless-cdp/`: **CDP route, headless. It measures a route that cannot click by design.** The same Webtop container ran headless Chromium over the debugging route: 10/25 passed (Kate and Dolphin 5/5 each; Settings, form and React 0/5 each), with 0 daemon refusals. The web failures are the route's deliberate lack of pointer, keyboard and click. The Settings failures came from the image lacking `kinfocenter` and a case-sensitive check, both since fixed. The provider-refused file there also includes the smoke runs from before this rerun. The harness version it ran was never committed; the current `../bench-webtop.mjs` replaced it (commit `ec57b23`).
- `../README.md`: the **host-only** run on minibeast (GNOME, Wayland), not in Webtop.

## Model-free proofs in this directory

- `route-probe.mjs` / `route-probe.txt`: the daemon's AT-SPI route drives the form, React and bad pages, with each effect confirmed outside the daemon.
- `missing-id.mjs` / `missing-id-without.txt` / `missing-id-with.txt`: a request without a string `id` was reported as `world/UnperformableElementError` before the fix and as `agent/MalformedParameter` after it.
- `settings-without.txt` / `settings-with.txt`: without `kinfocenter` there is no OS name to find. With it, the daemon reads `Kubuntu 26.04 LTS`.

Hashes are in `SHA256SUMS`.

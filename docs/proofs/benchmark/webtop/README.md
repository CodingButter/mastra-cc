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

The table was computed from `bench-webtop-a11y.jsonl`. Mean tokens are shown to one decimal (the earlier integer table truncated each mean); the exact total is unchanged. Recompute the per-task counts and means from this directory:

```sh
jq -s 'group_by(.task) | map({task: .[0].task, runs: length, passed: (map(select(.ok)) | length), meanSteps: (map(.steps) | add / length), meanTokens: (map(.tokens) | add / length), agent: ([.[].refusals[] | select(.class == "agent")] | length), world: ([.[].refusals[] | select(.class == "world")] | length), daemon: ([.[].refusals[] | select(.class == "daemon")] | length)})' bench-webtop-a11y.jsonl
jq -s 'map(.tokens) | add' bench-webtop-a11y.jsonl
```

| Task | Pass | Mean steps | Mean tokens | agent | world | daemon |
|---|---|---|---|---|---|---|
| kate | 5/5 | 12.0 | 1,128,591.6 | 0 | 2 | 0 |
| settings | 5/5 | 11.2 | 719,904.6 | 1 | 2 | 0 |
| files (Dolphin) | 5/5 | 4.6 | 254,333.4 | 0 | 0 | 0 |
| form | 5/5 | 20.0 | 1,775,951.4 | 0 | 0 | 0 |
| react | 5/5 | 18.0 | 1,419,342.8 | 0 | 1 | 0 |
| bad page | 4/5 | 20.2 | 2,104,803.8 | 0 | 9 | 0 |
| **All** | **29/30** | | 37,014,638 total | 1 | 14 | **0** |

| Refusal (class/code) | Count |
|---|---|
| world/UnperformableElementError (`screen grab failed: X Error … BadMatch`) | 13 |
| world/ElementGone | 1 |
| agent/OperationNotExposedError | 1 |

## Attribution

- **All 13 `UnperformableElementError` refusals** came from `captureElement`. The X server in the container refuses the screen grab with `BadMatch`; PR #138 (D1) maps this attempted route's refusal to `world`. A [later model-free diagnosis](../../webtop-capture/README.md) reproduced the failure on the actual KDE Wayland/Xwayland desktop while the same `xwd` binary succeeded on an isolated Xvfb control. The daemon has no compositor/portal capture fallback. This is not evidence that the applications cannot be captured or that an authorized Wayland route is impossible. Successful task runs did not demonstrate working screenshot support.
- **`ElementGone`** (bad#2): the agent used an element id after the page had redrawn. This is `world`, and the run still passed.
- **`OperationNotExposedError`** (settings#1): the agent asked to set the text of an element that does not publish editing. This is `agent`, and the run still passed.
- **bad#4, FAIL: the agent ran out of steps, and there is no daemon refusal.** In 30 steps it made:
  - 4 attempts at `captureElement` / `attestElement`, which led to its 3 world `BadMatch` refusals;
  - 11 `queryElements` calls, plus `discoverElements` and `describeDesktop`;
  - repeated `readElementContent` calls.

  Its last calls typed "Grace" and read it back (the daemon observed `Grace`). The persisted trace contains no subsequent press of "Send it" or "Subscribe". The record has `observed=null`, so there is no independent final-state observation for this run; that absence alone does not prove what the fixture server received. **The trace supports a step-budget/agent-pacing failure, not a demonstrated inability of the route to operate these controls.** The other four bad-page runs drove the same controls successfully.

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

## Reproduction and review qualifications

The published results were produced by harness commit `ec57b23`, before the scoring-loop review fix. None of the 30 scored records has a provider-infrastructure marker. The original shared provider log was manually partitioned: its last eight records were assigned to this accessibility run; its preceding fourteen records remain with the headless/smoke artifacts. This is weaker provenance than separate run-scoped logs; those historical files have not been rewritten.

The corrected harness derives the provider log from `--out` and, after four provider refusals, exits 2 without adding a scored record. Ordinary answer text is not classified as a provider error. From the repository root, with `GOOGLE_API_KEY` already set, use a fresh output filename to avoid appending another batch to the committed results:

```sh
node docs/proofs/benchmark/bench-webtop.mjs "$PWD" --runs 5 --out /tmp/webtop-rerun.jsonl
node --test docs/proofs/benchmark/webtop/provider-scoring.test.mjs
```

This creates `/tmp/webtop-rerun-provider-refused.jsonl` for provider failures. The four-attempt cap now stops an incomplete batch rather than presenting it as scored completion.

Remaining review limitations:
- The five-minute timeout races the model call without cancelling it; a timed-out run may leave work in flight during cleanup. This is a rerun risk, not proof of contamination in these published records.
- Cleanup is container-scoped and `DEPLOY` is a fixed nonempty constant, but it broadly kills benchmark applications and removes `/tmp/bench-*`; use a dedicated container, not a shared desktop.
- Settings uses a case-insensitive substring check, not a semantic check of the answer or a proof that the answer came from the About page.
- Kate's independent reader bypasses the daemon but shares AT-SPI; it verifies published document text, not a saved file. Saving is not the task.
- The fixed 500 ms settling delay is a timing assumption, not a bounded wait for the expected fixture state.
- The historical headless harness cannot be reproduced byte-for-byte because its source was not preserved. Those artifacts are historical evidence only, not a reproducible baseline.

## Model-free proofs in this directory

- `route-probe.mjs` / `route-probe.txt`: the daemon's AT-SPI route drives the form, React and bad pages, with each effect confirmed outside the daemon.
- `missing-id.mjs` / `missing-id-without.txt` / `missing-id-with.txt`: a request without a string `id` was reported as `world/UnperformableElementError` before the fix and as `agent/MalformedParameter` after it.
- `settings-without.txt` / `settings-with.txt`: without `kinfocenter` there is no OS name to find. With it, the daemon reads `Kubuntu 26.04 LTS`.

Hashes are in `SHA256SUMS`.

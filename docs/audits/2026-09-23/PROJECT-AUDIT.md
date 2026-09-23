# Mastra CC — full project audit (master @ 768b70e, 2026-09-23)

**Method.** I used a fresh `master` worktree and read the source of every subsystem. Behaviour was reproduced where possible, and the full gate suite was run from a clean install.

**Evidence labels:**
- **[repro]** — demonstrated by running code
- **[verified]** — read in source
- **[inferred]** — follows from source plus known platform behaviour, but was not executed

This audit is report-only. Nothing in the repo was changed.

## 1. What we are building
The project is a single chokepoint between an agent and a desktop. It provides:
- semantic observation through AT-SPI (native applications) and CDP (Chrome)
- effects under per-application capability grants, with a single driver
- content-free change pointers, with attribution
- audit receipts written at the point of effect

Beside the daemon sit three thin packages:
- generated protocol types (schema v1.26.0, 24 methods)
- a transport with a schema-digest handshake
- a Mastra adapter: one generated tool per method, a signal provider, a task lease, and about 40 KB of agent instructions

A Next.js demo (`desk-demo`) runs an agent against a real desktop.

Non-goals are explicit: vision-first control, an assistant UI, and authentication (auth belongs to the embedder).

## 2. Health snapshot
- **Gates:** clean install, then `generate`, then `turbo build lint typecheck test --force`: **19/19 tasks pass.**
- **Tests:** 93 daemon test files (954 passed, 25 skipped; the skips are the live-browser suites gated on `MASTRA_CC_LIVE`), 9 transport, 16 desktop, 18 tools and 7 desk-demo test files. **[repro]**
- **Lint:** 15 warnings in total (desktop 6, daemon 9). The daemon's include "short-circuits with undefined … will throw TypeError" optional-chain warnings. **[repro]**
- **Live lane:** `MASTRA_CC_LIVE=1` on this desktop (AT-SPI bus plus headless Chrome started on `:9744`) gave **93 files, 979/979 passed, 0 skipped. [repro]**
  - Without a browser already listening on `:9744`, 7 CDP conformance tests fail with "no debugging endpoint answered".
  - That prerequisite isn't documented next to the flag, and the suite doesn't start its own browser the way `channel.test.ts` does.
- **Mutations:** fresh full sweep on this commit: **292 entries, none survived. [repro]**
- **Size:** ~17k lines of non-test TypeScript, 111 ADRs, 2,181 proof files (42 MB of a 61 MB `.git`).

## 3. What we are doing right
- **The peripheral boundary is real in the code.** `desktopTools` is generated from `METHOD_DESCRIPTORS`, with no macros, retries or composite verbs. Judgment lives in the instructions.
- **Enforcement is structural.** An effect entry without before-call enforcement cannot be written in the dispatch table, and a runtime backstop repeats the check. Unknown methods are refused. The driver lease is checked before any handler runs. **[verified]**
- **Honest uncertainty.**
  - `typeText` marks its result `typing-unverified` and tells the model not to resend.
  - `clearElementText` counts first, caps its key presses, and refuses when it cannot verify.
  - The transport has no default reply budget; when a budget is exceeded, the outcome is reported as UNKNOWN (ADR-0109).
- **Launch is safe.** Recipes come from `.desktop` files and are parsed into an argv array with `shell:false`. Shell and flatpak wrappers are refused, as is unbalanced quoting. Launching still requires an explicit permit. **[verified]**
- **The demo refuses unsafe replays.** After a provider interruption, `desk-demo` will not auto-resume a turn if any tool was attempted, because desktop effects may already have happened (`api/chat/route.ts:79-83`). This is exactly the right instinct. **[verified]**
- **Digest handshake on both ends.** Event-path backpressure is bounded by measurement (ADR-0106).
- **Docs admit their history.** The roadmap marks M3–M6 retired and explains why. The P1 exit gate admits no cold agent has tried the package.

## 4. Implementation defects, by severity

### Critical

**C1. Web writes "verify" but do not reach React (and similar) apps. [repro]**
- **Where:** CDP `setElementText` / `setElementValue` (`cdp/effects.ts:124,185`). They do `this.value = v`, dispatch `input`/`change`, then verify by reading `this.value`.
- **Repro:** a React 19 controlled input in headless Chrome, driven with the daemon's exact function declarations:

  ```
  daemon-readback this.value = hello
  react state        = ""
  rendered <p>       = ""
  ```

- **Why it happens:** React's value tracker records the assignment, so the synthetic `input` event looks like no change. The effect reports success, the readback agrees, and the application never saw the text. It will revert on the next render or submit an empty form.
- **Scope:** most modern web apps.
- **Fix:** use the native prototype setter (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set`) or `Input.insertText`. Verify through the accessibility tree or the rendered state, not the property just written.

**C2. UTF-8 is corrupted across chunk boundaries. [repro]**
- **Where:** daemon `socketPipe.onData` (`server.ts` ~2822) and transport `socketWire.onData` (`transport/src/index.ts:216`) call `chunk.toString("utf8")` on each chunk separately.
- **Repro:** 200k em-dashes arrived with **15 U+FFFD replacements**.
- **Impact:** non-ASCII reads, typing and large captures can be silently altered. This breaks the "prove the text arrived" promise.
- **Fix:** `setEncoding("utf8")` or a `StringDecoder`.

**C3. One hung call freezes everything, and on CDP "hung" can mean forever. [repro]**
- **Repro:** real daemon (`startServer` + `CdpBackend`, visibility `all`) against headless Chrome on `:9744`. The page ran `setTimeout(()=>alert(1),5000)`.

  | Call | Result |
  |---|---|
  | Baseline `queryElements` | 33–39 ms |
  | Client A `queryElements` after the alert opened | still pending at the 20 s cap |
  | Client B (separate connection) | still pending at the 20 s cap |
  | Client C, `listApplications` (a method that needs no page) | still pending at the 5 s cap |

- Total observed stall: over 45 s with no refusal. Every client was blocked by one page dialog.
- **Global queue:** every request from every connection goes through one `serialised()` chain (`server.ts:2643`).
- **AT-SPI:** `invoke()` has no client timeout and relies on the bus's ~25 s NoReply. A tree walk against a frozen app costs 25 s per call. `dbus-native` 0.15.1 offers no per-call timeout.
- **CDP:** the channel has no timeout and no `Page.javascriptDialogOpening` handling. The repro above shows the result: every client waits.
- **Fix:** per-call deadlines on both channels, dialog detection for CDP, and let observes stop queuing behind a single global chain.

### High

**H1. CDP instrumentation lives in the page's main world. [verified]**
- **Where:** `Runtime.addBinding("__mastraCcChange")`, `window.__mastraCcStream`, and every `callFunctionOn` on objects from `DOM.resolveNode`, all without an isolated world.
- **Impact:** a hostile page can:
  - forge change events by calling the binding with a matching `watchId`
  - tamper with the stream
  - monkeypatch `value` getters, `dispatchEvent` or `focus` so effects and readbacks lie
  - detect automation
- **Fix:** `Page.createIsolatedWorld`, `addScriptToEvaluateOnNewDocument({worldName})`, and bindings scoped by `executionContextName`.

**H2. The browser is reachable around the daemon. [verified]**
- **Where:** Chrome runs with `--remote-debugging-port=9744` (fixed; `cdp/channel.ts:22`, `launch/recipes.ts:85,103`), including the Gmail profile.
- **Impact:** any local process can drive it without a grant or a receipt. The "only process that touches the desktop" claim is false for the browser the daemon itself launched.
- **Fix:** `--remote-debugging-pipe`.

**H3. Prompt injection is not addressed anywhere. [verified by absence]**
- **Exposure:** the agent reads document text, web pages and mail through `readElementContent` / `queryElements` and then acts with edit/submit grants.
- **Gap:** there is no ADR on untrusted content. The 40 KB agent instructions never tell the model that desktop content is data, not instructions. A search of the instructions and ADRs for "untrusted" / "injection" found nothing relevant. For a product whose demo reads Gmail and can submit, this is the biggest conceptual security gap. It is also not an auth concern, so it stays in scope under the "auth is the embedder's" stance.

**H4. Refusals come back two different ways, and neither is structured. [verified]**
- **Channel 1:** handler refusals return as `result.refusal`, which the tool hands back as data.
- **Channel 2:** gate, ownership and backend-failure refusals return as top-level `response.refusal`, which the transport turns into a thrown bare `Error`. The adapter's comment says refusals are never thrown.
- **Not structured:** `refusalClass` exists internally but is not in the schema. Programs have to string-match English, contradicting the README's "names its reason in bytes the caller can act on".

**H5. A second daemon deletes a live daemon's socket. [verified]**
- **Where:** `startServer` does `rmSync(socketPath, {force:true})` unconditionally.
- **Impact:** the first daemon keeps running, unreachable, and keeps its launched applications. This breaks "one driver per desk" at the process level.

### Medium
- **M1. No inbound line-length limit.** `buffer += chunk` has no cap in the daemon or the transport, and it applies before the hello. A peer that never sends a newline exhausts memory. **[verified]**
- **M2. Element maps never shrink.** ATSPI `answered`, `byNative`, `applicationOf` and `applicationRootOf`, plus the CDP `answered` map, only ever `.set`. A daemon meant to run forever grows with every element and every application restart. CDP effects never call `Runtime.releaseObject` on resolved objects, so they also pin page objects. **[verified]**
- **M3. The README over-claims.** It says typing is verified by read-back internally; the code says unverified. The code is right. **[verified]**
- **M4. Generated types sit outside the task graph.** `protocol/generate.mjs` is not a turbo task. On a clean worktree, `turbo typecheck` fails until someone runs it by hand, and turbo's cache cannot key on `schema.json`. **[repro]** This is the root cause of the repeated stale-artifact and digest-mismatch incidents in this project, and of the `capturedAt` drop surviving until live testing. Make generation a turbo task that `schema.json` is an input to, and add a test that every schema parameter reaches `backend.*`.
- **M5. A proof switch ships in production code.** `MASTRA_CC_ATSPI_DEAF_FOR_PROOF` (`atspi/channel.ts:122`) silently disables event registration. **[verified]**
- **M7. Grants trust whatever name an application gives itself. [verified]**
  - `grants.ts` and `atspi/names.ts` match visibility on the name the application self-reports over AT-SPI, NFKC-normalised and case-folded.
  - Any local process can call `GLib.set_prgname("firefox")` and become visible under Firefox's grant; the CC-01 fixture does exactly this to name itself.
  - No ADR discusses spoofing. The launch table does bind identity to (pid, start time), but only for processes the daemon launched, and grants don't use it.
- **M8. The audit log is best-effort, not fail-closed. [verified]**
  - `openAuditLog.record` catches write failures and logs "audit entry NOT WRITTEN" to stderr. The effect has already happened and still succeeds.
  - The writes are synchronous `appendFileSync` with no fsync or rotation.
  - This may be the right trade-off, but ADR-0026 should say so, because the README presents receipts as a guarantee.
- **M6. The WebSocket has no Origin check.** Agreed direction: an allow-list, with authentication left to the embedder, recorded in an ADR. **[verified]**

### Low
- `DISPATCH[request.method]` reads through the prototype. `"constructor"` resolves to `Object`, and the backstop then refuses it with a misleading message.
- Audit writes use synchronous `appendFileSync` on the effect path, with no fsync. Crash durability is unspecified.
- A single malformed daemon line terminates the whole transport connection. That is defensible, but it is not documented.
- The instructions are about 40 KB (roughly 10k tokens) on every turn, and have grown by accretion. The original24 failure was fixed by adding more prose. Instruction size and quality should be measured, not just appended to.

## 5. Structure and concept
- **`server.ts` is 3,048 lines (166 KB).** Grants, launch, focus restoration, subscriptions, stall policy, dispatch, both pipes and metrics live in one module. H5, M1 and the earlier `capturedAt` drop all sit in it. Split it along the seams its own comments name.
- **The chokepoint thesis has leaks:** CDP (H2), H1, other processes on the D-Bus session bus, and covered-window typing (CC-01). Call the daemon "the only *audited* route" until those are closed.
- **Web and native are unequal.** The native path is deeply hardened. The CDP path has C1, C3, H1 and H2, and generic Chromium/Electron is unsupported (roadmap P1). Yet the headline demo errand is Gmail.
- **Validation is inverted relative to hardening.** There are 111 ADRs and 2,181 proof files, but no cold agent has used the package and there is no success rate across applications. The biggest run is one Mousepad errand. C1 shows the cost: the proof culture was pointed at native widgets, and web-app correctness went unexamined.
- **Evidence weight.** 42 MB of proofs in git. Move them to release assets or LFS, and keep hashes in git.
- **Platform reach.** X11 plus AT-SPI, and Chrome. There is no Wayland, and `xwd` is X-only.
- **Review process.** PRs #99–#119 merged with model review only.

## 6. Hygiene
- The main checkout is on `feat/a-field-can-be-emptied`, 79 commits behind master.
- Screenshot PNGs are committed at the repo root.
- The Anthropic key pasted in chat on Sep 7 should be rotated.

## 7. Recommended order
1. C1 (native setter / `Input.insertText`, with verification through app state) and C2 (decoder). Both are small and silently wrong today.
2. C3: per-call deadlines on both channels, CDP dialog handling, and a queue that is not global.
3. H1 and H2: isolated world, and `--remote-debugging-pipe`.
4. H3: an untrusted-content ADR, plus instruction text and an injection test page in the proofs.
5. H4 (structured refusal class in the schema, one refusal channel) and M3 (README).
6. H5, M1, M2, M4 (generation as a turbo task, a params-reach-backend test), then split `server.ts`.
7. A cold-agent, multi-app benchmark (native and web) with a published success rate before further hardening.

## 8. Coverage and limits of this audit
- **Read:** daemon server and dispatch, pipes, ATSPI channel and typing/clearing, the CDP channel/effects/subtree stream, launch parsing and spawning, transport, the desktop adapter and lease, the demo chat route, turbo/CI configuration, and the schema.
- **Ran:** the full gates and two reproductions (C1, C2).
- **First-pass reviewed as well:**
  - **Grants:** `grants.ts`. Deny-by-default holds, and a malformed file fails loudly. Name spoofing is M7.
  - **Replay backend:** it loads captured tapes only and throws on an unrecorded exchange, which is sound.
  - **ATSPI label enrichment:** `labels.ts` enforces the 250 ms per-element and 500 ms per-operation budgets.
  - **Launch:** `launch/*` (table identity is pid plus start time).
  - **Audit:** `audit.ts` (M8).
  - **Daemon entry point:** `main.ts` flags. The socket path falls back to `/tmp` when `XDG_RUNTIME_DIR` is unset.
  - **ADRs:** statuses of all 111 were tallied. All are accepted or explicitly superseded, and I found no broken supersession links.
- **Tests** were validated by behaviour rather than read one by one: the full default and live lanes pass, and 292/292 mutations were killed.
- **Repro scratch** lived only in a disposable second worktree (`/tmp/cc-audit2`), and the test file was deleted afterwards. No repository source was modified.

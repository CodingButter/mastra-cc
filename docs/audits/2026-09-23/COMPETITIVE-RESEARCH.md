# How Claude and Codex control the desktop, and what Mastra CC should take from it (2026-09-23)

All claims come from public web sources and vendor docs. Vendor security numbers are self-reported.

## How each one works

| | Claude (Cowork / Claude Code computer use) | Codex (desktop app) | macOS Harness (browser-use, OSS) | Cua Driver (OSS) |
|---|---|---|---|---|
| **Perception** | Screenshots first | AX tree plus screenshots on macOS; Windows reported as screenshot-first | Screenshots, AX, AppleScript, CDP | Window pixels plus UIA/MSAA tree |
| **Input** | macOS Accessibility permission, synthetic mouse and keys | Background virtual cursor through private WindowServer (SkyLight) routing; no focus steal | PID-targeted events; never raises the app or moves the pointer | Painted synthetic cursor, separate from the user's pointer |
| **Routing** | Connector first, then Chrome extension, then the screen | In-app browser, then computer use | The model writes code on top of primitives | Driver via MCP |
| **Permissions** | Per-app approval each session; warnings for apps with shell or filesystem reach; terminal excluded from screenshots; one session holds a lock | Per-app targeting (`@Paint` vs `@computer`); pauses for passwords | None | — |
| **Injection defence** | RL-trained model, input probes and a per-action classifier; about 0–0.3% attack success on newest models (vendor figure) | Hands control back on sensitive input | None | — |

## Lessons for us, ranked

1. **Adopt the input/action split for untrusted content (fixes audit finding H3).**
   - Claude screens incoming content for injection, and a second check compares each action with the user's request before it runs.
   - The model alone reached 3.7% attack success; the product stack reached 0%. The layers did most of the work, not the model.
   - Our daemon already sits on both seams: reads go through `readElementContent`/`queryElements`, and every effect passes the gate.
   - Proposal: an optional `contentProvenance: "untrusted"` tag on read results, plus a pluggable pre-effect hook in the desktop package that an embedder can wire to a classifier or to a human confirmation.
   - This keeps us a peripheral. We supply the seams; the judgment stays in the embedder.
2. **Treat risky apps as their own grant class.** Claude warns before approving apps that grant shell, filesystem or settings access. Our grants are flat per-app names. Add a "broad-reach" tag so grants of terminals, file managers or settings require an explicit flag.
3. **Stop feeding the agent's own surface back to it.** Claude hides its terminal from screenshots so prompts shown on screen can't loop back into the model. Our analogue is to deny-list the embedder's own UI and terminal from visibility even under `all`, and to exclude them from captures.
4. **Tie identity to the process, not to the name the app reports (audit finding M7).** Codex and Harness target by PID. We already record (pid, start time) for apps we launch; extend that to grants with an optional executable-path or PID binding.
5. **Background lane without stealing the cursor.** This is the headline UX win for Codex, Harness and Cua. On AT-SPI we are already mostly there: semantic actions don't move the pointer. Raw-input paths steal focus, though, and CC-01 showed covered typing lands. Make "no foreground change" an advertised capability per method, and prefer semantic `DoAction`/`SetText` over emitted keys wherever possible.
6. **Always hand control back for secrets.** Codex pauses whenever a password is needed. Add a refusal class for `role=password-text` edits unless a flag allows them. It's cheap and it's easy to defend.
7. **The escape-hatch debate.** Harness bets on six raw primitives plus model-written code. Canvas-drawn UI forces everyone back to coordinates. We deliberately confine pixels. Keep that, but measure how often agents hit a dead end with no semantic route; that's the benchmark we lack (audit §5).
8. **Validation culture.** Every vendor ships success rates on OSWorld/WebArena-style suites. We have none. A cold-agent, multi-app benchmark (native plus web) should come before more hardening.

## Where we are already ahead
- **Structural refusals and receipts.** No product above exposes audit receipts or named refusals. Harness explicitly has no receipt on its raw path.
- **Semantic-first on Linux.** Codex's AX approach validates our thesis. Nobody ships Linux: Codex has Windows on the roadmap, Claude is macOS-only.
- **Honesty about uncertainty.** The typing-unverified state and UNKNOWN reply outcomes are more rigorous than anything in the public docs I found.

## Suggested next steps
1. An ADR on untrusted content and action review: provenance tag, pre-effect hook, and a secret-field refusal (items 1 and 6).
2. Grant hardening: broad-reach class, self-surface exclusion, identity binding (items 2–4).
3. A benchmark harness before any further hardening (item 8).

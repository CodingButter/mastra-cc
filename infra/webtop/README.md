# Webtop semantic desktop harness

This opt-in development harness proves the built daemon and built transport against a real Webtop desktop and AT-SPI bus. Use replay and the Xvfb witness for fast routine checks; use this harness when desktop-session behavior, browser-visible state, or volume persistence matters.

## Prerequisites

- Docker with Compose support
- The pinned Webtop image (Compose pulls it when absent)
- `pnpm turbo run build` completed on the current worktree
- A free loopback port (default `13300`)

## Commands

```bash
pnpm turbo run build
bash infra/webtop/demo.sh
bash infra/webtop/recreate.sh
bash infra/webtop/diagnostics.sh
bash infra/webtop/cleanup.sh
```

`demo.sh` ends with `PROOF: GREEN`; `recreate.sh` ends with `PERSISTENCE: GREEN`. Both are bounded and clean up only the Compose project selected by `MASTRA_CC_WEBTOP_PROJECT` (default `mcc-webtop-harness`). Set `MASTRA_CC_WEBTOP_PORT` to change the loopback Webtop port.

The live scenario writes a fixed non-sensitive proof sentence through built `@mastra-cc/transport`, re-queries the same element, and requires exact semantic read-back. It also observes a real password control and requires `{ kind: "redacted", reason: "protected" }` without carrying its value.

Diagnostics contain container metadata, process state, socket state, and bounded daemon logs. They must not contain protected content. Proof screenshots and Playwright traces belong under the uncommitted plan proof directory, never in the repository.

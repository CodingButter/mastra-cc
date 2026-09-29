# Webtop semantic desktop harness

This opt-in development harness proves the built daemon and built transport against a real Webtop desktop and AT-SPI bus. Use replay and the Xvfb witness for fast routine checks; use this harness when desktop-session behavior, browser-visible state, or volume persistence matters.

## Prerequisites

- Docker with Compose support
- The pinned Webtop image (Compose pulls it when absent)
- `pnpm turbo run build` completed on the current worktree
- A free loopback port (default `13300`)

## Authorized capture opt-in

The default XWD route is unchanged. Operator-installed KWin capture is selected
only with `MASTRA_CC_ATSPI_CAPTURE=kwin` on the daemon process; other nonempty
values fail startup, and KWin failures never silently fall back. See the
[native helper operator guide](../../daemon/native/kwin-capture/README.md) for
installation, revocation, limits and the measured single-output scale-one envelope.
The isolated capture proof additionally requires the opt-in render-node/EGL
Compose override; it does not change this harness's defaults.

```bash
DOCKER_HOST=unix:///var/run/docker.sock bash infra/webtop/authorized-capture/demo.sh \
  --mode branch --artifact-root /absolute/build/root --proof-dir /absolute/proof/dir
```

This deterministic installed-daemon proof uses only synthetic pixels and AT-SPI
product requests. Add `--scenario geometry` or `--scenario cleanup` for the live
boundary cases. The [fresh installed base/branch proof](../../docs/proofs/webtop-authorized-capture/README.md)
provides the `run-pair.sh` command, measured RED/GREEN results and read-only viewer
recording instructions. Recording reuses an existing Playwright installation;
it is not a new project dependency or a substitute acquisition route.

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

## Capture qualification

The benchmark container was observed running KDE Wayland with Xwayland, not Xvnc. Its X root-window capture command (`xwd -root -silent`) returns `BadMatch`; accessibility-task success does not establish screenshot support. The [model-free capture diagnosis](../../docs/proofs/webtop-capture/README.md) pairs that failure with a same-container Xvfb control and records KDE screenshot authorization and portal availability. It changes neither desktop permissions nor the daemon's capture backend. Check the actual session rather than inferring its display architecture from the Webtop image name.

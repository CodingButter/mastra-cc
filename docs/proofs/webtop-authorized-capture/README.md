# Authorized Webtop capture — baseline

This baseline establishes the environment for an operator-installed native KWin ScreenShot2 helper. It does **not** demonstrate authorized capture; no helper or runtime selection exists yet. Default XWD acquisition and the wire contract remain unchanged.

## Recorded environment

- Base: `b546ab62ec8f14bf9539663e0d4ceb0f00dc65cf` (merged PR #141), matching refreshed `origin/master`.
- Isolated branch: `feat/webtop-authorized-capture`; worktree `/tmp/core-webtop-authorized`; initially clean.
- Docker endpoint: `unix:///var/run/docker.sock`; server `29.7.2`.
- Fresh project/container: `mcc-authorized-capture`; no matching container or volumes existed before setup.
- Pinned and inspected image: `lscr.io/linuxserver/webtop:ubuntu-kde@sha256:d91fb284794d554d89b4b210ebe56a538c755dfb2054a3741ed7471363cd5369`.
- Loopback viewer: `127.0.0.1:13310`; port availability checked before creation.
- Measured processes: `kwin_wayland --no-lockscreen --xwayland --xwayland-display=:1`; Xwayland uses `-rootless`.
- Installed versions: `kwin-wayland 4:6.6.6-0ubuntu0.1`; Qt Core/DBus `6.10.2+dfsg-7`.

## Baseline checks and setup qualification

Protocol generation, `pnpm install`, and `pnpm turbo run build` exited 0 (6/6 build tasks, all cached). Existing capture tests passed 36/36; daemon typecheck, lint, documentation and diff checks exited 0. Lint reported 54 existing warnings, no errors.

The existing Webtop start script created the desktop and daemon sockets but exited 1 at client readiness: copied transport artifacts lacked their declared runtime dependencies. Copying the already installed `ws` 8.18.3 and generated `@mastra-cc/protocol-types` packages into `/opt/mastra-cc/node_modules` produced `READINESS: GREEN`. No dependency was added or upgraded; no existing harness script was changed. Future capture orchestration must deploy these dependencies reproducibly rather than copying only transport dist files.

## Proof scope still to implement

Use fresh isolated synthetic desktops and installed daemon/client/helper artifacts. Prove explicit authorization and revocation, supported single-output origin-zero scale-one crops (including occluders), unsupported geometry refusal, bounded image handling and cancellation cleanup. Run branch GREEN before identical base XWD RED and record read-only viewer corroboration. Do not collect personal pixels or run paid models.

Authorization feasibility and independent geometry agreement remain unproven. Same-UID callers can invoke an authorized executable; rectangle and pixel sampling are not atomic. See the [prior acquisition diagnosis](../webtop-capture/README.md) for historical evidence, not a claim that this new route works.

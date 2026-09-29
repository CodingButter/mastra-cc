# Authorized Webtop visible-desktop capture

## Installed proof — September 29, 2026

Two independently initialized pinned Webtop containers reproduced branch **GREEN** followed by base **RED**. The installed branch daemon returned a 160×80 crop whose interior RGB `(24,96,168)` and bounds matched the synthetic Qt fixture independently. The installed base daemon reached its existing XWD acquisition and refused with `world/UnperformableElementError`, `screen grab failed: ... BadMatch`. This is not a setup or unknown-option failure.

- Base: `b546ab62ec8f14bf9539663e0d4ceb0f00dc65cf` (merged PR #141).
- Runtime head: `99321bc4341fbcd42985ac33fc0220ce3445bc4f`; proof orchestration was an uncommitted addition during execution, retained in each run's source diff/status and source hashes.
- Accepted run: `pair-FSIUlvrC`; fresh repeatability run: `pair-c7km8byZ`. Both exited 0 with `PAIR: GREEN`.
- Image: `lscr.io/linuxserver/webtop:ubuntu-kde@sha256:d91fb284794d554d89b4b210ebe56a538c755dfb2054a3741ed7471363cd5369`.
- Docker: `unix:///var/run/docker.sock`; projects `mcc-authorized-capture-branch` and `mcc-authorized-capture-base`, loopback ports 13311 and 13312.
- Measured KWin 6.6.6 / Qt 6.10.2, OpenGL/EGL, one `WL-0` output at `(0,0)`, 1024×768, scale 1. Both containers use the opt-in render-node override; the default harness is unchanged.
- Package versions, fixture hashes/geometry, grants and compositor layout compared byte-for-byte between containers. Intended differences: built branch/base artifacts and branch-only helper installation/authorization and capture selector. Container identity, viewer port and process IDs necessarily differ.

The browser recordings show only the synthetic desktop. Viewport and main canvas are 1024×768; WebM metadata and complete decoding were checked. They corroborate visibility, not daemon pixel provenance. No model or CDP product action was used. Recordings are session-local, not committed.

## Reproduce

Prerequisites: Docker access, host `/dev/dri/renderD128`, Node/pnpm, Python 3, ffmpeg/ffprobe, an existing Playwright installation with Chromium, and free ports 13311/13312. No npm dependency is added for recording. Set `MASTRA_CC_PLAYWRIGHT_ROOT` to that installation's package root. The command refuses existing named containers, volumes or networks, builds both artifact roots, creates fresh desktops, preserves diagnostics and removes only its owned projects.

```sh
DOCKER_HOST=unix:///var/run/docker.sock \
MASTRA_CC_PLAYWRIGHT_ROOT=/home/codingbutter/.npm/_npx/9833c18b2d85bc59 \
bash /tmp/core-webtop-authorized/infra/webtop/authorized-capture/run-pair.sh \
  --base b546ab62ec8f14bf9539663e0d4ceb0f00dc65cf \
  --branch-root /tmp/core-webtop-authorized \
  --proof-dir /home/codingbutter/mastra-cc/.mastracode/plans/webtop-authorized-capture.proof
```

Expected: branch `PROOF: GREEN`, base `PROOF: RED`, then `PAIR: GREEN (installed branch GREEN; installed base RED)`. Missing prerequisites or failed assertions return nonzero; no transcript scrubber converts failures to success.

The proof directory contains `demo.sh`, `README.md`, `with.txt`, `without.txt`, `viewer.webm`, `pair.txt`, case transcripts and `SHA256SUMS`. Each `pair-*` directory retains separate setup logs, daemon/fixture diagnostics, artifact hashes, package versions, geometry, grants, source provenance, viewer PNG/JSON/WebM and cleanup logs. Verify with `sha256sum -c SHA256SUMS` in that directory. [Sanitized verdicts and hashes](results.txt) are committed; pixel artifacts are not.

## Operator contract

The [native helper instructions](../../../daemon/native/kwin-capture/README.md) describe explicit root-owned installation, authorization, revocation and service-cache refresh. Only the dedicated executable is authorized, never Node or Python. Daemon startup does not install authorization.

- Unset/empty `MASTRA_CC_ATSPI_CAPTURE`: existing XWD route.
- Exactly `kwin`: `/usr/local/libexec/mastra-cc-kwin-capture`.
- Other nonempty values: startup exits 2 before listening.
- Explicit KWin failures never fall back to XWD.
- Only one origin-zero, scale-one output with corroborated geometry is supported. The opt-in GPU/EGL setup is required by this pinned image; its default QPainter compositor did not provide working ScreenShot2 acquisition.
- Existing 16 MiB pixel and 4 MiB encoded-image limits, bounded frame header, acquisition deadline and process-group cancellation remain enforced. No wire/schema/refusal-code change.

## Boundary evidence and limitations

Earlier installed scenarios demonstrated denied/authorized/revoked helper lifecycle; real compositor scale 1→1.5 refusal and restoration; overlap and clipping pixels; moved/resized element refusal; cancellation, timeout, early exit, malformed frames and successful recovery without residual helper processes/FDs. Paired branch setup repeats native and helper lifecycle checks. Wrong arguments, missing build, unrelated container/project, invalid/out-of-range ports and conflicting resources were rejected nonzero without resource creation.

One earlier helper lifecycle attempt reported a truncated payload before a frame prefix. It failed closed; its root cause is **unresolved**, not fixed by subsequent success. Retained diagnostics, 80 consecutive captures and ten lifecycle stress runs document the risk. Both fresh pairs passed without that failure.

Authorization does not isolate same-UID callers. Captures include visible occluders, not authenticated application-owned pixels. Rectangle and pixel sampling are not atomic; detectable geometry changes refuse, but sampling races remain. Protected targets refuse before acquisition; unrelated overlapping sensitive pixels are not separately identified. Rotation tests cover geometry-source disagreement, not every possible rotation. This is not arbitrary Wayland, scaled or multi-output support.

See the [historical XWD diagnosis](../webtop-capture/README.md). Final full mutation sweep, independent ship review and human approval remain separate gates; this proof is not shipping approval.

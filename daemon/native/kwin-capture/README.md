# Operator-authorized KWin helper

This dedicated executable requests visible workspace pixels from KWin ScreenShot2.
It does not change the daemon's default XWD route; daemon integration is separate.

## Installation and revocation

Run `infra/webtop/authorized-capture/install.sh /absolute/source-root build` as root
inside the disposable Webtop container. This installs only the named build packages
`g++`, `pkg-config`, `qt6-base-dev`, then builds against distribution Qt6 Core,
DBus and Gui. Compiler flags: C++20, `-O2 -Wall -Wextra -Werror -fPIC` plus
`pkg-config` flags. The installed executable is root-owned, mode 0755, at
`/usr/local/libexec/mastra-cc-kwin-capture`.

The separate `authorize` operation installs the matching application declaration
under `/usr/share/applications/`; `revoke` removes it. After either operation run
`kbuildsycoca6 --noincremental` in the desktop user's session. Cache propagation
is asynchronous: the proof polls fresh helper processes for the expected result
under a finite deadline. Never authorize Node, Python or another interpreter.
To uninstall completely, revoke and remove the installed executable as root.
The daemon never installs authorization. No permission bypass is used.

Run the helper as desktop UID 1000 with its Wayland and session D-Bus environment.
Authorization is executable-based, **not isolation against other same-UID callers**.

## Measured support envelope

The pinned Webtop image initially used QPainter, for which the measured KWin
capture route returned Cancelled. The isolated opt-in `compose.gpu.yml` supplies
`/dev/dri/renderD128` and requests OpenGL. On the measured Intel/Mesa host this
established OpenGL/EGL capture. The default Compose file is unchanged. Hosts
without this render node or usable EGL must not be presumed supported.

The helper compares Qt screen geometry with KWin `supportInformation` before and
after capture: exactly one enabled origin-zero, scale-one output is supported.
It also compares captured dimensions and scale. KWin's human-readable layout
format is version-sensitive; unrecognized layouts fail closed. This is not
atomic geometry/pixel sampling or proof of application ownership. Occluders
remain visible. AT-SPI element-coordinate agreement still needs integration proof.

## Private frame and limits

Stdout contains a four-byte big-endian JSON-header length, at most 4096 bytes of
UTF-8 JSON, then exactly `bytes` of RGB pixels. Header version 1 includes format,
width, height, stride, x, y, scale and layout. Diagnostics go to stderr only.
Raw image storage is capped at 16 MiB; checked stride arithmetic precedes metadata
acceptance. Pixels arriving before metadata are drained into the same bounded
buffer. Conversion from supported Qt RGB32/ARGB32 formats is in place, including
unpremultiplication. EOF and exact payload length are both required.

A ten-second whole-process alarm also bounds toolkit initialization. Cooperative
loops enforce the same deadline and SIGTERM/SIGINT cancellation; stdout is
nonblocking. A stalled consumer can receive an incomplete frame before failure;
consumers must reject incomplete frames and every nonzero process exit. The
helper spawns no children. Process exit closes its descriptors, including on alarm.

## Verification

`bash daemon/native/kwin-capture/test.sh` runs native deterministic tests where Qt
build dependencies are installed. `bash infra/webtop/authorized-capture/helper-proof.sh`
operates only the reserved `mcc-authorized-capture` project. It installs/builds,
checks denied/authorized/revoked fresh processes, validates exact frame lengths
and independent compositor geometry, exercises cancellation/stalled-output/
closed-reader cleanup and successful recovery, and leaves authorization revoked.
It does not yet prove an installed daemon's element crop or a fresh base/branch pair.

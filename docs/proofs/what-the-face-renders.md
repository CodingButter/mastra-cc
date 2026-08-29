# What the face renders

> **Retired 2026-08-28 — historical record.** This proof measured the client surface (face, widget, voice lane) removed by [ADR-0057](../02-DECISIONS/0057-mastra-cc-is-a-peripheral-not-an-assistant.md). The command that produced it no longer exists in the tree. It is kept because decisions still cite it as their evidence, and evidence deleted under a decision it justifies cannot be audited. Nothing here describes what ships today.


**Produced by:** the command below, against commit `ede14aa`

**Date:** 2026-08-23  
**Host:** minibeast  
**Desk:** repository Xorg dummy-driver desk on `:84`, two connected 1024×768 outputs, openbox, stalonetray, and `xcompmgr -n`  
**Artifact:** [`m4-face-rendered.png`](m4-face-rendered.png)  
**SHA-256:** `695c7b7341c9bc04303fcb6ef816cee4b1796ff73b6ba9e10fea8e4783693499`

This answers Q22's appearance half: does the built face paint the orb and caption without restoring the discarded rectangular background? Geometry and input shape remain measured separately by [`what-the-face-does-on-a-real-desk.md`](what-the-face-does-on-a-real-desk.md).

## Limitations

- The captured desk uses synthesised Xorg outputs, openbox, a standalone tray, and `xcompmgr`; it does not prove appearance under another compositor, display scale, physical bezel, or desktop environment.
- The progress sentence is synthetic lane state. It proves the shipped lane-to-main-to-preload-to-renderer path paints current state; it does not exercise a model or microphone.
- Pixel checks establish the expected regions and alpha compositing. They do not establish whether a person likes the design.
- Human confirmation below was on minibeast's real desktop, not the dummy-driver screenshot. It is a separate witness and is not promoted into the machine measurement.

## Result

The 2048×768 capture contains the full two-output desk and the face at 220×220+40+40.

- The orb's cyan-family pixels occupy the expected `FACE_LAYOUT` circle bounds.
- The caption crop contains 166 colours, including 385 text-colour-family pixels and 29 exact `#e2e8f0` pixels. Before the preload fix it contained only two background colours and no text pixels.
- Transparent regions composite with the desk instead of painting the pre-fix opaque black rectangle.
- The menu occupies the expected 30×30 region.

The first capture found a real defect: Electron's sandbox did not load the bundled ESM preload, so `window.mastraFace` was absent and the initial caption never reached the DOM. The regression was reproduced in `the-face-hears-the-hub.test.ts`, fixed by shipping a CommonJS preload plus an explicit renderer-ready replay, and guarded by two mutations.

## Human witness

After the fix was launched on minibeast's real desktop, Jamie reported: “I see the caption now.” Before the fix he saw the circle with no caption, while also confirming there was no surrounding window or square. The live witness therefore agrees with the machine capture on both caption paint and transparent presentation.

## Reproduction

The repository desk is started first. A compositor is added because an X11 alpha window without one is captured against black even when its transparent visual is correct.

```bash
infra/x11-desk.sh up :84
DISPLAY=:84 xcompmgr -n &

# Start a lane server whose current state is progress("Rendering proof"), then:
env -u WAYLAND_DISPLAY DISPLAY=:84 \
  apps/widget/node_modules/.bin/electron \
  --no-sandbox --ozone-platform=x11 --disable-gpu --in-process-gpu \
  --disable-software-rasterizer --user-data-dir="$(mktemp -d)" \
  apps/widget/dist/main.mjs

DISPLAY=:84 import -window root docs/proofs/m4-face-rendered.png
sha256sum docs/proofs/m4-face-rendered.png
infra/x11-desk.sh down :84
```

The exact lane frame used by the capture was:

```json
{"event":"progress","detail":"Rendering proof"}
```

# Native restoration: private GTK proof (2026-09-06)

From the repository root, after building the updated daemon, transport, and desktop packages together:

```sh
bash docs/proofs/native-restoration-2026-09-06/demo.sh
```

This is a restoration GREEN harness, **not** a merge-base RED comparison. Executed successfully on September 6, 2026: exact text readback, independently measured 301×34 PNG, exact agreement across 2,376 interior pixels (142 colors), rejection of blank and six shifted controls, and a real GTK button callback. See [transcript](evidence/with.txt), [pixel witness](evidence/pixel-witness.json), [image](evidence/entry.png), and [independent root XWD, gzip-compressed](evidence/root-after.xwd.gz). This proves native operations, not general model task competence.

## Requirements

Linux/X11; installed `Xvfb`, `dbus-run-session`, GTK3 `yad`, `xwd`, `xwininfo`, `node`, `timeout`, and `at-spi-bus-launcher` (at-spi2-core). The existing daemon dependency `dbus-native` must be installed. No added production dependencies, Python bindings, window manager, personal desktop, or external services are needed. Local loopback WebSocket traffic is intentional.

## What must pass

1. Start a fresh Xvfb display selected by `-displayfd`, a private D-Bus session/accessibility bus, and a real yad form with one entry and one command button.
2. Connect **through the built desktop package's public `connect({url})` entrypoint** to the built daemon's real WebSocket listener on an ephemeral loopback port.
3. Discover the one textbox, verify its initial value, set different text, and independently read its exact content back through the public API.
4. Read the one native entry's screen extents through a separate read-only D-Bus connection. Save an independent `xwd -root` snapshot, then capture via public `captureElement`. Require transport and decoded PNG dimensions to match that measurement. The proof-only `pixels.mjs` independently decodes XWD TrueColor pixels (24/32-bit storage, either byte order, row stride and color-table offset) and noninterlaced RGB8 PNG (all five scanline filters). Compare **every RGB byte exactly** in a 108-pixel-wide interior region starting at entry-local (12, 6), ending six pixels above the bottom. This witnesses the beginning of the recognizable edited text, not borders or the end-of-text caret. Private GTK settings select Monospace 12 and disable blinking/animations; a bounded 300ms paint wait precedes the root snapshot. Require at least four independently observed colors and at least 2% non-dominant pixels. A blank fill and root crops shifted by ±1 pixel on each axis and +8 pixels on either axis must fail the same equality criterion. Save `root-after.xwd`, `entry.png`, `entry-bounds.json`, and `pixel-witness.json` (region, independently derived color histogram, comparison rule, negative controls). Artifacts preceding a failed assertion remain available; the witness report is written only on success.
5. Query the command button and call public `clickElement`. Require both non-refused readback and the fixture's previously absent `clicked` marker. The yad BTN command keeps the form alive, avoiding an ambiguous vanished-element readback. Merely returning success cannot pass.

Every refusal, missing side effect, malformed result, or timeout exits nonzero. Only successful completion prints `PROOF: GREEN`, from the outer script. Per-call waits are bounded at eight seconds, driver lifetime at 65 seconds, and private session at 90 seconds with five-second kill escalation. Normal exit and signals clean up launched processes. Artifacts and daemon/fixture/accessibility/Xvfb logs remain in the printed `/tmp/native-restoration.*` directory for inspection.

## Offline checks and execution

```sh
node --check docs/proofs/native-restoration-2026-09-06/driver.mjs
node --check docs/proofs/native-restoration-2026-09-06/pixels.mjs
bash -n docs/proofs/native-restoration-2026-09-06/fixture.sh
# Only after source/build workers finish and the targeted packages are rebuilt:
bash docs/proofs/native-restoration-2026-09-06/demo.sh
```

No new executable dependency is introduced; the existing missing-tool and launcher-location checks remain unchanged. Unsupported XWD layouts fail explicitly rather than silently skipping content verification. Exact equality is intentionally fail-closed if the scene changes between snapshots. The interior witness does not verify every pixel outside its region or reject every conceivable repeated-content displacement. Synthetic offline checks exercised both XWD byte orders, 24/32-bit storage, padded rows/color-table offset, all five PNG filters, truncation, matching crops, blank/shifted captures, and a uniform root oracle; these are not a live GREEN result.

## Source basis and limits

- `infra/demo.sh` supplies the private Xvfb/D-Bus/yad pattern and launcher locations.
- `daemon/src/main.ts` defines `--grant yad`, `--allow edit`, `--allow activate`, `--allow rawInput`, `--socket`, `--ws-host`, `--ws-port 0`, and the listener announcement parsed here.
- `packages/desktop/src/index.ts`, its built declarations, and `packages/transport/src/index.ts` define the public entrypoint and calls. `protocol/golden/src/index.ts` defines their result shapes.
- `geometry.mjs` uses the D-Bus signatures from the native channel and pointer sources, but never calls their implementation. It is measurement only; all edits, clicks and image requests use the public daemon transport.

The capture contract under restoration is **visible root pixels cropped to the entry rectangle**, not ownership-isolated pixels. This minimal harness does not place an overlay or assert occlusion behavior; that requires a separate witness. It does not prove compositor/Wayland behavior, hidden-window recovery, pointer recipient security, PNG CRC validation, or every possible native control. A hard SIGKILL may bypass shell cleanup. Rebuild before running: stale built artifacts are not evidence for the new source.

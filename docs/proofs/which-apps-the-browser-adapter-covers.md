# Which apps the browser adapter covers

Produced by `spikes/browser/electron-attach.mjs`, which is deleted at the end
of M0.5.

The browser adapter is only worth building if the daemon can work out *by
itself* which applications it applies to. A hardcoded list of known Electron
apps would answer the question by assuming it, and would be wrong the first
time somebody installs something we never heard of.

## Classification

Applications are classified from **filesystem evidence next to the binary** —
the artifacts a Chromium distribution leaves behind — never from their name.
Launcher entries whose `Exec` is a shell wrapper are followed to the binary
they exec, because the evidence sits beside the real one.

| Measured | |
|---|---|
| Applications inventoried from launcher entries | 68 |
| Classified Chromium-based | **3** |

| Application | Binary | Evidence |
|---|---|---|
| `code-url-handler` | `/usr/share/code/code` | 6 markers: resources.pak, chrome_100_percent.pak, icudtl.dat |
| `com.google.Chrome` | `/opt/google/chrome/google-chrome` | 4 markers: resources.pak, chrome_100_percent.pak, icudtl.dat |
| `discord` | `/home/codingbutter/.config/discord/app-1.0.152/Discord` | 7 markers: resources/app.asar, resources.pak, chrome_100_percent.pak |

## Attaching is not the same as being readable

The app is launched twice: once plainly, and once with
`--force-renderer-accessibility`. Attaching succeeds either way, so attach
success is not evidence of a usable tree.

| Observation | Plain launch | With `--force-renderer-accessibility` |
|---|---|---|
| Attached | `code-url-handler — Chrome/148.0.7778.280` | same binary |
| Accessibility nodes | **505** | **505** |
| Named controls | **42 (e.g. menuitem "File"; menuitem "Edit"; menuitem "Selection")** | **42 (e.g. menuitem "File"; menuitem "Edit"; menuitem "Selection")** |

An earlier version of this spike measured only the plain launch, got a
three-node tree, and recorded it as a successful attach. Three nodes is the
same signature an unreadable Chrome shows, and calling that a success is
precisely the vacuous pass this repository treats as worse than no measurement.
The run now waits for the window to render before reading, so a small tree
means an empty tree rather than a slow one.

## What this settles

The adapter's applicability is **derived, not declared**. That matters beyond
tidiness: it is the difference between an adapter that covers the applications
a person actually has and one that covers the applications we happened to think
of. The same evidence tells the daemon how to launch the app — a Chromium-based
binary takes a debugging port and its own data directory, and everything else
goes to the platform's accessibility adapter.

## Receipt

```
node spikes/browser/electron-attach.mjs --launch code --port 9491
```

# What the browser protocol gives us

Answers the CDP half of **Q01** and the substrate questions behind it. Produced
by `spikes/browser/cdp-substrate.mjs`, which is deleted at the end of M0.5.

Run against a disposable profile. Since Chrome 136 `--remote-debugging-port`
is ignored unless `--user-data-dir` points somewhere other than the default
profile, so the separate profile is a constraint imposed by the browser, not a
design preference we adopted.

| Question | Measured |
|---|---|
| Debugging endpoint | `Chrome/150.0.7871.186` |
| Target types auto-attached by one browser-level arm | `background_page,page,service_worker` |
| `addScriptToEvaluateOnNewDocument` runs before page script | **yes — page script observed the marker (both within the same millisecond)** |
| Cross-site iframe attaches without re-arming | **no** |
| Cross-site iframe attaches after re-arming on the page session | **yes (1: http://b.test:33127/child)** |

## How injection ordering was proven

Not by observing that the init script ran. The **page's own script** reads a
global that only the init script could have set, and the run refuses to write
this file if that read comes back false. A probe that merely confirms its own
script executed proves nothing about ordering.

## Why the iframe question matters

A subscription or recorder installed on a page does not automatically reach a
cross-site frame: those run out-of-process and are separate targets. Whatever
we install has to be re-armed per attached session, recursively, or coverage
silently stops at the first frame boundary. Same-process frames are a different
case entirely — they are execution contexts inside the parent target and get no
target of their own.

## Notes

- 4 sessions attached at browser level: background_page, page, service_worker

## Receipt

```
node spikes/browser/cdp-substrate.mjs --port 9412
```

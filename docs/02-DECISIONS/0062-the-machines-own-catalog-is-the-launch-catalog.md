# 0062 — The machine's own catalog is the launch catalog

**Status:** accepted
**Date:** 2026-08-31

## Context

`openApplication` could start four programs. `daemon/src/launch/recipes.ts:49-102` held
`yad`, `chrome`, `gmail` and `qt6ct`, and `capabilityStateFor()` reported
`launch: not-exposed` for everything else — *before* consulting any permit
(`daemon/src/server.ts:345-347`). The same lookup decided the `launchable` field of every
`listApplications` entry (`server.ts:424`). In the harness container that meant 4 of 59
installed applications could be started; an agent could only ever operate software a human
had already opened for it.

The four were not an architecture. Each was added deliberately for a real reason — the spawn
primitive and ownership table (`7ce11b8`), Chrome and its debugging port (`beba9c2`), named
profiles (`a82a4a2`), real Gmail (`e1ae83f`), and the Qt6 accessibility knob after
measurement showed Qt6 publishes an application root with zero children without it
(`18111d9`). Nothing ever generalised them. The product read as an API integration with a
hand-maintained list of supported applications, which is the opposite of what a desktop
peripheral is for.

Meanwhile the daemon already read the only file that answers "how do I start this".
`inventory.ts:71-127` scans `XDG_DATA_HOME`/`XDG_DATA_DIRS` in freedesktop precedence order
to answer `listApplications`, parses the `[Desktop Entry]` group, reads `Type`, `Name`,
`NoDisplay`, `Hidden` — and deliberately throws away `Exec`.

## Decision

**The launch catalog is the machine's own catalog, and the hand-written recipes are an
overlay on it.**

`deriveLaunchCatalog(directories)` (`daemon/src/launch/derived.ts`) turns every
`Type=Application` desktop entry with a usable `Exec` into a `LaunchRecipe`, keyed by the
same normalised desktop-entry id `listApplications` already reports. `main.ts` composes it
once at boot as `{ ...derived, ...CATALOG }` through the named helper `baseLaunchCatalog()`,
then applies operator profiles, then composes boot names.

Five things this decision commits to:

**Built-ins win collisions.** `CATALOG` overlays the derived base, so a
`google-chrome.desktop` entry on the machine can never displace the `chrome` recipe's
debugging port or the `gmail` recipe's profile directory. Those directories are authority
boundaries, not configuration — ADR-0038. The overlay is keyed through the same `normalise()`
the rest of the launch code uses, so an NFKC-form variant cannot slip past the exact-string
case either.

**Accessibility enabling generalises through environment, not argv.** Every derived recipe
carries `GTK_MODULES=gail:atk-bridge` and `QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1` — the two
knobs already proven in this repository, applied as a static union rather than per
application. This extends ADR-0027 rather than replacing it: readability is still decided
once at process start, so the enabling still rides the launch. The union is safe because
toolkits ignore environment variables they do not read, which is exactly the property argv
flags do not have. That asymmetry is the whole reason the enabling generalises and the
`chrome` recipe does not.

**The parser refuses rather than mangles.** `Exec` is parsed per the freedesktop spec:
quoting honoured, field codes (`%f %F %u %U %d %D %n %N %i %c %k %v %m`) removed, `%%`
literal. An empty, unbalanced, or field-code-only `Exec` produces **no recipe** —
degrading to exactly today's refusal for that one entry while every well-formed neighbour
works. `Terminal=true` entries produce no recipe, because a `shell: false` spawn with no tty
would report success while nothing appeared. Shell and wrapper `argv[0]`s — `sh`, `bash`,
`dash`, `zsh`, `env`, `flatpak`, `snap` — produce no recipe, for two independent reasons:
`Exec=sh -c "…"` would reintroduce a command line through the file, and an `appearsAs` of
`sh` is a tree name no window will ever report.

**`appearsAs` is load-bearing, not a detail.** Desktop-entry ids and AT-SPI tree names
disagree constantly — `org.kde.kate` versus `kate`. Every derived recipe sets `appearsAs` to
the normalised basename of `argv[0]`, which flows through `expandThroughAppearsAs`
(`profiles.ts:128-149`) so `--permit org.kde.kate` implies observing `kate`. Without it the
launch succeeds and the application is invisible, which is not a capability anyone wanted.

**Capability grew; authority did not.** ADR-0019 is intact. A launch still requires an
explicit permit, deny-by-default stays, no wildcard was added, and an unpermitted derived
launch refuses with the unchanged authority refusal. A name the machine does not provide
still gets `NO_RECIPE_REFUSAL`, byte-identical, still naming nothing about the filesystem.
Wire input selects a catalog *key*; argv is static data composed at boot from files the
daemon read itself, and `shell: false` stays. That invariant is the single most important
property of this change.

## Consequences

**Chromium and Electron applications are not usable through generic launch.** Measured, not
assumed: a derived `chromium.desktop` recipe starts the browser and the browser publishes
nothing readable within 10s — `the application was opened but did not become readable within
10000ms - refusing to pretend it is ready`, zero roots. The cause is architectural. A
browser's readability is a CDP debugging port, not the accessibility bus; the `chrome` and
`gmail` recipes inject `--remote-debugging-port=9744` and a non-default `--user-data-dir`
for exactly that reason, and the CDP backend reads that one fixed endpoint. Derivation
detects no browser family, so no port is allocated and no endpoint exists. **No flag was
invented to paper over this** — closing it needs family detection across wrapper scripts and
bundled runtimes, dynamic port allocation replacing the constant, and a multi-channel CDP
backend replacing the single endpoint. Three real pieces of work, recorded as a follow-up.

**An application outside GTK3 and Qt6 may launch and stay unreadable.** The env union covers
the two toolkits this repository has measured. The proof launches one application from each
family and claims exactly that; anything beyond it is a limit, not an implication.

**Some entries will never derive, silently.** Wrapper-based, terminal-only, and malformed
`Exec` lines refuse. The operator sees a `launchable: false` and no explanation, because the
refusal names nothing about the filesystem by design. An operator-supplied override file is
the natural fix and is deliberately not built here — it would have been the same
hand-maintained list moved one directory over, which is precisely the objection this decision
answers.

**The catalog grew from 4 entries to ~58, and `findRecipe` is a linear scan**
(`spawn.ts:18-24`) called per application per capability. Boot went from 0.671987887s to
0.674236044s in the live container — one sample each, which cannot separate 2ms from noise,
and no threshold is asserted. At this size neither cost is real; if either becomes real, that
is a follow-up and not a redesign.

**A derived catalog in a spawnable test path can launch anything installed.** Strictly worse
than the issue #20 case that produced `DEFANGED_CATALOG`. The guard in
`no-real-catalog-in-a-spawnable-path.test.ts` was widened to recognise a derived catalog
reaching a `LaunchContext` literal — its previous regex would have passed vacuously against
the new form — and the Phase 2 tests use a defanged derived catalog throughout.

**Nothing reached the wire.** `protocol/schema.json` is unchanged, the schema digest did not
move, the wire-facing inventory entry keeps its shape, and no argv, path, or command line appears in any
response, refusal, or diagnostic. The wire already said `openApplication(name)` and already
reported `launchable`; this change only made those two statements true about more names.

## Evidence

- The gap, as behaviour: [docs/proofs/any-app-the-machine-has.md](../proofs/any-app-the-machine-has.md),
  with the red transcript captured from a base worktree at
  `7ae05a681a600b2de4001185e00300f9ebbf1df0` and the green from this branch — same container,
  same errand, only the daemon build differs.
- Two applications from two toolkit families launched by the agent and read afterwards:
  Kate (Qt6, root `app-1c573c5ef1a2`) and Mousepad (GTK3, root `app-6b0712d04d54`).
  `PROOF: GREEN`, five tool calls.
- The ratio this moves: 4 of 59 launchable on base, 58 of 59 on this branch, both measured in
  one container session.
- The Qt6 knob's original measurement, which this generalises: `18111d9` and
  `recipes.ts:91-101`.
- Derivation rules and every refusal case: `daemon/src/launch/__tests__/derived.test.ts`.
  Wiring, authority preservation, built-in precedence including the NFKC variant, profile
  collision, `appearsAs` expansion, hostile boot inputs, and the response-body leak check:
  `daemon/src/__tests__/any-app-the-machine-has.test.ts`.
- Commits `ac7e7b5` (derivation) and `b126702` (wiring).

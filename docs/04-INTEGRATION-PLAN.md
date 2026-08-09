# 04 — Integration Plan

**Goal:** Mastra CC can be moved into the `mastra-ai/mastra` monorepo as a directory move, with no renames, no restructuring, and no surprises.

**Why this document exists first:** the prototype deferred this question and paid PR #227 for it on day seven — 179 files, 135 renames, one production outage, and five in-flight branches broken mid-turn. The integration story is cheapest to design when the repository is empty. → [ADR-0014](02-DECISIONS/0014-monorepo-droppable-from-commit-one.md)

**Method note:** everything in §1 was read out of a live checkout of `mastra-ai/mastra`, not recalled. Guessing the destination's conventions would be the exact mistake [03-LESSONS.md §2](03-LESSONS.md) is about.

---

## 1. What the destination actually looks like

Verified against a working checkout at `/home/codingbutter/mastra`.

**Workspace management.** pnpm workspaces, driven by `pnpm-workspace.yaml`, with Turborepo on top (`turbo.json`).

**Top-level structure is by domain, not one flat `packages/`.** The workspace globs include `packages/*` but also `voice/*`, `browser/*`, `stores/*`, `channels/*`, `signals/*`, `pubsub/*`, `client-sdks/*`, `auth/*`, `observability/*`, `workflows/*`, `workspaces/*`, `agent-sdks/*`, `deployers/*`, `integrations/*`, `server-adapters/*`, `embedders/*`, plus `mastracode/{sdk,tui,factory,factory-ui,mastra-factory}`.

That is the single most important fact for this plan: **a new capability area gets its own top-level domain directory**, in the manner of `voice/` (which holds eleven-plus provider packages) or `signals/` (which currently holds one).

**Shared task graph.** `turbo.json` defines `build`, `lint`, `lint:fix`, `typecheck`, `clean`, `dev`, and `validate:package`. `build` depends on `^build`; `typecheck` depends on `^build`. A package that cannot express itself in those five verbs does not fit.

**Toolchain, and it is opinionated:**

| Concern | The monorepo's choice |
|---|---|
| Package build | `tsdown`, per-package config |
| Test runner | `vitest`, pinned by catalog at `4.1.10` |
| Lint | `oxlint` **and** `eslint` |
| Format | `oxfmt` and `prettier` (with the Tailwind plugin) |
| Versioning / release | Changesets |
| License | Apache-2.0, with an `ee/` carve-out |

**Catalog pins that matter to us:**

| Dependency | Monorepo catalog | Prototype used |
|---|---|---|
| `typescript` | `^6.0.3` | `^7.0.2` |
| `vitest` | `4.1.10` | `4.1.10` ✅ |
| `zod` | `^4.4.3` | `3.25.76` ❌ major-line gap |
| `react` / `react-dom` | `^19.2.5` | `19.2.8` ✅ compatible |

**And the fact that shaped everything else: there is no Python anywhere in the monorepo.** A search for `*.py`, `pyproject.toml`, `Cargo.toml`, and `go.mod` outside `node_modules` returns nothing. The monorepo is a TypeScript monorepo.

> **Updated 2026-08-09.** This used to be the plan's hardest constraint, because the daemon was Python. It is not any more — see §4 and [ADR-0030](02-DECISIONS/0030-the-daemon-is-one-node-process.md). The observation above is kept because it remains true of the destination and is still the reason the rest of this document reads the way it does; it is simply no longer an obstacle.

---

## 2. The target layout

Mastra CC becomes a **top-level directory named `desktop/`, a sibling of `mastracode/`** — a peer product, not a package domain beneath one.

> **Corrected 2026-08-09, and the distinction is not cosmetic.** This section originally read `desktop/` as a domain directory in the `voice/` and `signals/` mould: a group of packages. It is a sibling of `mastracode/` instead, because Mastra CC is a *product* built on the same coding-agent runtime rather than a library family. The practical consequence is that everything `mastracode` can do is available to the hub — its tools coexist with the accessibility-tree surface rather than being replaced by it. Q12 in [09-QUESTIONS.md](09-QUESTIONS.md) records the choice and its cost: a sibling does not inherit a plugin host's lifecycle, so process supervision and configuration are ours.

```
mastra/
├── desktop/
│   ├── protocol/            # @mastra/desktop-protocol   — schema, generator, golden fixtures
│   ├── transport/           # @mastra/desktop-transport  — the one daemon client
│   ├── voice-gate/          # @mastra/desktop-voice-gate — wake fingerprinting, capture, session dial
│   ├── hub/                 # @mastra/desktop-hub        — the brain
│   ├── widget/              # @mastra/desktop-widget     — Electron tray face
│   ├── dashboard/           # @mastra/desktop-dashboard  — Vite config surface
│   └── daemon/              # @mastra/desktop-daemon      — Node; an ordinary workspace package (see §4)
└── pnpm-workspace.yaml      # one added line: `- desktop/*`
```

Our development repository is laid out so this is a `git mv` of one directory:

```
mastra-cc/                        →  mastra/desktop/
├── packages/transport/           →  desktop/transport/
├── packages/voice/               →  desktop/voice-gate/
├── protocol/                     →  desktop/protocol/
├── apps/hub/                     →  desktop/hub/
├── apps/widget/                  →  desktop/widget/
├── apps/dashboard/               →  desktop/dashboard/
├── daemon/                       →  desktop/daemon/
├── infra/                        →  desktop/infra/
└── docs/                         →  desktop/docs/
```

**Note the one honest wrinkle:** our development layout uses `apps/` and `packages/`, and the destination flattens those into `desktop/*`. That is a *move of six directories one level*, mechanically trivial and history-preserving with `git mv`, and it is a deliberate choice — `apps/` and `packages/` are the right shape for a standalone repository, and collapsing them at integration time is a five-minute operation. What matters is that no package is *renamed* and no import path inside a package changes, because every cross-package import already goes through a scoped package name rather than a relative path.

**Package naming** is fixed now, at the start, so imports never change: `@mastra/desktop-*`. Chosen over `@mastra/cc-*` because the destination names things after what they do (`@mastra/voice-openai`, `@mastra/client-js`), and "cc" means nothing to a reader who was not in the room.

---

## 3. Conformance rules, adopted from day one

Each rule below is a thing the destination requires. Adopting them now costs nothing; adopting them later costs a migration.

| # | Rule | Why |
|---|---|---|
| C1 | Every package is buildable with `tsdown` | `turbo run build` must work |
| C2 | Every package exposes `build`, `test`, `lint`, `typecheck`, `clean` | the shared task graph |
| C3 | `vitest` at the catalog version, `4.1.10` | already aligned |
| C4 | **`zod` v4**, not v3 | catalog is `^4.4.3`; the prototype's v3 usage would be a migration |
| C5 | TypeScript compatible with the catalog's `^6.0.3` line | the prototype's `^7.0.2` would need reconciling |
| C6 | `oxlint` + `eslint` clean, `oxfmt` + `prettier` formatted | matches the destination's lint tasks |
| C7 | Apache-2.0 headers and license | the monorepo's default |
| C8 | Changesets on every user-visible change | how the monorepo releases |
| C9 | No cross-package relative imports — scoped names only | makes the directory move a no-op |
| C10 | No package depends on repository-root position | the keeper-shim class of bug ([03-LESSONS §1.4](03-LESSONS.md)) |
| C11 | `react` / `react-dom` from the catalog line | dashboard and any UI package |

**C4 and C5 are the two real pieces of work**, and they are the reason this document exists before the code. Writing the hub against zod v3 and TypeScript 7 and then discovering the destination is on zod v4 and TypeScript 6 is exactly the day-seven surprise this plan is designed to prevent. **Start on the catalog versions.**

**A note on C5.** The version lines here move; the catalog was read on 2026-08-08. The rule is not "use TypeScript 6 forever" — it is *pin to whatever the destination's catalog says, re-check before each milestone, and never let the gap become a migration.*

---

## 4. The Python daemon — the obstacle that no longer exists

**Superseded 2026-08-09 by M0.5's measurements. This section previously weighed three options for getting a Python daemon into a TypeScript monorepo. There is no Python daemon.**

The obstacle was real and correctly stated: the destination contains no Python, no Python tooling, and no CI lane that would run a Python test suite. What was wrong was the premise underneath — that Linux accessibility requires the Python bindings at all. It does not. Accessibility on Linux is plain D-Bus underneath, and a direct-to-bus implementation in Node matched the Python route on every capability the daemon needs:

| Capability | Receipt |
|---|---|
| Enumerate and walk | [can Node read the accessibility tree](proofs/can-node-read-the-accessibility-tree.md) — 18 applications, matching a Python control exactly; 400 nodes |
| Write | [can Node act on the desktop](proofs/can-node-act-on-the-desktop.md) — text inserted and verified; action invoked with its effect measured on the tree |
| Events | [can Node be told the desktop changed](proofs/can-node-be-told-the-desktop-changed.md) — 6 signals attributable to a cause at 138ms, against 639 received |

Option C — "rewrite the daemon in TypeScript" — was assessed above as *not worth it for repository tidiness*, on the grounds that AT-SPI bindings are mature in Python and not in Node. That assessment was correct about the bindings and wrong about the need for them. The relevant ruling is now [ADR-0030](02-DECISIONS/0030-the-daemon-is-one-node-process.md), which supersedes [ADR-0010](02-DECISIONS/0010-daemon-is-python-single-threaded-default-glib-context.md)'s language choice while keeping its single-thread constraint.

**What this changes for integration:** `desktop/daemon/` becomes an ordinary pnpm workspace package. One CI story, one toolchain, one release graph. The maintainer conversation in Stage 2 loses its hardest item, and the Debian package becomes a packaging concern rather than a language concern.

**What it does not change:** the daemon still ships as a `.deb` because it is a system service with a systemd unit, and that packaging question is untouched by the language it is written in.

**One constraint survives the rewrite and must not be lost:** everything touching the accessibility layer is serialised. What was measured is that `libatspi` aborts the process deterministically when used from two or more threads ([is the accessibility binding thread-safe](proofs/is-the-accessibility-binding-thread-safe.md)) — a library this daemon does not load, so the rule is carried on design grounds and the measurement is owed on the new route ([ADR-0030](02-DECISIONS/0030-the-daemon-is-one-node-process.md) clause 3).

---

## 5. What else does not fit, and what to do about it

| Item | Fit | Plan |
|---|---|---|
| **Electron widget** | No precedent in the monorepo | It builds with the standard verbs and ships in the `.deb`. If it is unwelcome, it is the second candidate to live outside — after the daemon. Design it so that is possible. |
| **`infra/`** | Host configuration for one product | Moves with the directory. It configures our services, not the monorepo's. |
| **Proof artifacts** | Need a real desktop and sometimes a person | Never a CI gate ([ADR-0012](02-DECISIONS/0012-claims-needing-a-desktop-are-proved-by-artifact.md)). They are a release gate, run on hardware, artifacts committed. |
| **`docs/`** | The monorepo has its own `docs` workspace package | Our documents move as `desktop/docs/`. Anything belonging in published documentation gets contributed there separately, and that is a deliberate, later act. |
| **The `.deb`** | No packaging precedent in the monorepo | Built by a workflow, released independently of the npm packages. |

---

## 6. Sequence

Integration is not one event. It is four, and the first three happen while we are still standalone.

**Stage 0 — now, continuously.** Conform to C1–C11. Every package scoped, buildable, and independently testable. Catalog versions from the first `package.json`. Re-read the destination's catalog before each milestone in [07-ROADMAP.md](07-ROADMAP.md) and record any drift.

**Stage 1 — after the vertical slice works.** Dry-run the move in a scratch clone of the monorepo: copy the tree to `desktop/`, add one line to `pnpm-workspace.yaml`, run `pnpm install`, then `turbo run build lint typecheck test --filter='./desktop/*'`. Fix whatever breaks *in our repository*. Throw the scratch clone away. Repeat at each milestone — this is a test, and it should be scripted as `tools/dry-run-integration.sh`.

**Stage 2 — the maintainer conversation.** With a working system and a green dry run, raise: the `desktop/*` workspace glob, the Electron question, and the `.deb` release workflow. (The Python question is gone — see §4.) Not before there is something to look at.

**Stage 3 — the move.** `git mv` into `desktop/`, one line in `pnpm-workspace.yaml`, changesets for the new packages, CI green. If Stage 1 has been running all along, this stage is boring, which is the entire objective.

---

## 7. Verification gate for this plan

This plan is only real if it is executable. It is verified by a script, not by agreement:

```
tools/dry-run-integration.sh
```

**It must:**

1. Clone or copy a pristine `mastra-ai/mastra` checkout to a scratch directory.
2. Copy our tree into `desktop/`, flattening `apps/` and `packages/` one level.
3. Add `- desktop/*` to `pnpm-workspace.yaml`.
4. Run `pnpm install`, then `turbo run build lint typecheck test --filter='./desktop/*'`.
5. Diff our declared dependency versions against the destination's catalog and **fail on any divergence**, naming each one.
6. Exit non-zero on any failure and write no success artifact.

Point 5 is the one that earns its keep. It is how the zod-v3-versus-v4 gap gets caught on day two instead of at integration, and it is a direct application of the proof-script discipline in [ADR-0012](02-DECISIONS/0012-claims-needing-a-desktop-are-proved-by-artifact.md): a check that cannot check must not report success.

**This gate runs from the first milestone**, when the only thing in `desktop/` is an empty protocol package. A dry run that passes on an empty tree and keeps passing is the whole trick.

---

## Receipts

| Claim | Source |
|---|---|
| workspace globs incl. `voice/*`, `signals/*`, `mastracode/*` | `/home/codingbutter/mastra/pnpm-workspace.yaml`, read 2026-08-08 |
| turbo tasks: build, lint, typecheck, clean, dev, validate:package | `/home/codingbutter/mastra/turbo.json` |
| catalog: typescript `^6.0.3`, vitest `4.1.10`, zod `^4.4.3`, react `^19.2.5` | `pnpm-workspace.yaml` catalog block |
| tsdown builds, oxlint+eslint, oxfmt+prettier, changesets | root `package.json`; `voice/openai/package.json` |
| Apache-2.0 with an `ee/` carve-out | `LICENSE.md` |
| no Python / Rust / Go anywhere outside `node_modules` | `find` for `*.py`, `pyproject.toml`, `Cargo.toml`, `go.mod` |
| `voice/` holds 11+ provider packages; `signals/` holds one | directory listings |
| prototype used zod `3.25.76`, typescript `^7.0.2` | `client/package.json`, `clients/widget/package.json` |
| prototype dashboard react 19.2.8 | `dashboard/package.json` |
| reshape cost: 179 files, 135 renames, one outage, five branches | PR #227; 2026-08-07 18:27–18:39 |

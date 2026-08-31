# 12 — Release

What this repository publishes, and the one rule that governs it.

## What is publishable

| Package | Published | Why |
|---|---|---|
| `@mastra-cc/protocol-types` | yes | Generated from `protocol/schema.json` (ADR-0009). Its version *is* the schema version. |
| `@mastra-cc/transport` | yes | The one client that dials the daemon (ADR-0003, pin B5). |
| `@mastra-cc/daemon` | **no** | Ships as a systemd install (`infra/apply.sh`), not as a library. |
| the workspace root, `tools` | **no** | Build machinery. |

`tools/release-check.mjs` holds this list. Adding a package to the release surface
is an edit to that list, deliberately — never a side effect of a glob.

## The rule: the two artefacts version separately

ADR-0057 says this project ships two things: a **daemon**, which is engineering — it
is testable, and a release of it is done — and an **installable package**, which is
judgment, and drifts with every model that consumes it. They release on different
clocks.

So:

- The daemon's version and any published package's version are **never required to
  match**, and nothing may make them match by accident.
- No published package may depend on `@mastra-cc/daemon`. It is private, so the
  dependency could never resolve — but the deeper reason is the clock, not the
  resolution.
- A published package may not pin a sibling to the daemon's version number.

`tools/release-check.mjs` enforces all three.

## What the release check actually checks

For each publishable package it runs `pnpm pack`, unpacks the tarball **outside the
workspace**, and reads what landed:

1. **No `workspace:` specifier survived.** pnpm rewrites those at pack time; if that
   ever stops happening the package is uninstallable off-repo.
2. **Every declared entry point exists** (`main`, `types`, `module`, `bin`, `exports`).
   A `files` list that forgets `dist` produces a package that resolves to nothing.
3. **Every dependency is a usable range, and none of them is private.**

It also refuses to pass on an empty publishable set — a release check that checked
nothing is the failure it exists to prevent.

Run it locally with `node tools/release-check.mjs`. It runs in CI after `build`,
because it inspects `dist`.

## Publishing itself

Nothing here publishes to a registry yet. The check is a dry run by construction:
`pnpm pack` writes a tarball to a temporary directory and the script deletes it.

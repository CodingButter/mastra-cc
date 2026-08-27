# ADR-0054 — Gmail authority is composed by the operator-owned unit

**Status:** accepted, 2026-08-27

## Context

M6 Stage 1 froze the meaning of *"tell me my most recent email"* in [the north-star contract](../10-NORTH-STAR-CONTRACT.md). Stage 2 must configure the authority needed by later stages without launching Gmail, widening the model's tools, handling credentials, or changing that contract.

The daemon already keeps four settings separate: session launch authority (`--permit`), observe intent (the grants file), durable per-application capability subtraction (the capabilities file), and the audit destination (`--audit`). Browser profile identities are a fifth setting, but M6 does not need a replacement profile: the built-in `gmail` recipe already names the persistent profile the operator signs into manually. Its accessibility tree appears as `chrome`.

The dangerous join is asymmetric. Observe visibility must follow `appearsAs`, otherwise a permitted Gmail launch would become unreadable. Launch authority must not follow it, because that would turn permission to launch `gmail` into permission to launch the separate built-in `chrome` identity.

## Decision

The systemd user unit at `infra/units/mastra-desktop-daemon.service` is the M6 boot-composition owner. It starts the complete installed daemon tree at `%h/.local/lib/mastra-cc/daemon/main.mjs` and supplies:

- `--permit gmail` as the sole launch authority;
- `--grants %h/.config/mastra-cc/gmail-grants.json` for explicit operator observe intent;
- `--capabilities %h/.config/mastra-cc/gmail-capabilities.json` for durable launch subtraction;
- `--audit %h/.local/state/mastra-cc/audit.jsonl` as the explicit receipt destination.

The repository seeds the two operator files only when absent. It never overwrites later operator edits. The grants seed names exactly `gmail`; this is explicit intent and defense in depth, while the launch permit is the operative implied observe grant. The capabilities seed sets `defaults.launch` to false and enables launch only for `applications.gmail`.

The M6 application identity is the built-in `gmail` recipe and its manually signed-in persistent profile. No profiles file is supplied, and changing this identity requires a superseding ADR.

The composed result is intentionally asymmetric:

- launch authority is exactly `{gmail}`;
- effective observe visibility is exactly `{gmail, chrome}` because `gmail` declares `appearsAs: chrome`;
- a separately running built-in `chrome` tree is therefore observable, but the built-in `chrome` identity is never launch-permitted;
- launch capability is enabled only for `gmail`; every other inventory identity reports `defaults.launch` as the setting withholding launch.

The hub and model own none of these settings. The model's minted observe floor remains exactly `queryElements`, `attestElement`, and `listApplications`; `openApplication` is absent. The existing `hub --open` command remains a human-invoked daemon client and can exercise a permit only when an already-authorized operator invokes it. Stage 2 adds no orchestrator launch seam and does not invoke that command.

Configuration is loaded only at daemon boot. Granting or revoking authority means editing the operator-owned files and restarting the daemon. The daemon retains its no-default-audit-path rule; this composition opts in explicitly rather than weakening it.

## Consequences

A fresh installation has a reproducible, restrictive authority tuple while subsequent operator choices remain locally owned and reversible. The unit is installed but not enabled, so installation does not decide when the daemon runs and does not launch Gmail.

The honest cost is that Gmail's `appearsAs` join exposes any separately running built-in Chrome tree to observe calls. That cost is bounded: launch remains keyed to the unexpanded catalog identity, and exact-set tests plus executable mutations fail if the Gmail permit or grants argument disappears.

`defaults.launch: false` also changes inventory answers for every non-Gmail identity on an installed machine. This is deliberate: the refusal names the owner setting that can change the answer instead of pretending the application lacks the capability.

The operator must restart the daemon after edits; there is no live reload. Manual Gmail sign-in remains outside daemon and model context. The daemon does not read, list, or stat the profile directory, and credentials and cookies never enter configuration, audit records, fixtures, proofs, or logs.

## Evidence

- `infra/config/gmail-grants.json` and `infra/config/gmail-capabilities.json` are the restrictive seeds.
- `infra/apply.sh` seeds missing operator files, preserves edits, protects config/state paths, and installs the complete daemon module tree plus the repository's `tools/pins/deny-list.json`; the backend's upward lookup therefore uses the same pinned vocabulary in the repository and installed layout.
- `infra/units/mastra-desktop-daemon.service` contains the exact startup composition and remains unenabled by the installer.
- `daemon/src/__tests__/m6-gmail-startup-composition.test.ts` loads the real unit and templates and proves the exact launch, observe, capability, audit, and model-tool sets.
- `tools/__tests__/m6-gmail-config-install.test.mjs` proves installation, modes, idempotence, edit preservation, tree replacement, import resolution, and dry-run non-mutation.
- `tools/mutations.json` contains `m6-gmail-permit-removed` and `m6-gmail-grants-removed`; both make the focused composition test fail.
- [ADR-0036](0036-grants-live-in-a-file-the-daemon-owns.md), [ADR-0038](0038-a-browser-profile-is-a-launch-identity.md), [ADR-0042](0042-existence-is-readable-content-is-not.md), and [ADR-0043](0043-an-element-publishes-its-own-actions.md) define the authority layers this record composes without merging.

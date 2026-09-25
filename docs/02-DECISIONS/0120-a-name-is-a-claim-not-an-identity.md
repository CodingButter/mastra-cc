# ADR-0120: A name is a claim, not an identity

Date: 2026-09-25
Status: Accepted. Proof in [grant-identity](../proofs/grant-identity/README.md). Closes audit item M7. Narrows ADR-0036: a grant still names an application, and now it also binds that name to an executable.

## Context

Visibility (ADR-0036) admitted an application by the name it publishes on the accessibility bus. Any process can publish any name: `GLib.set_prgname("firefox")` is one line. On the base, a Python script calling itself `firefox` was read and handed to the agent as the granted Firefox, including the contents of its fields.

## Decision

A grant admits a name only from the process running an executable the grant names.

- **Who owns the connection.** The bus daemon answers `GetConnectionUnixProcessID` for the application's unique bus name. The bus says which process it is, not the application.
- **What it runs.** The kernel answers `/proc/<pid>/exe`. Answers are cached per unique bus name, which the bus never reuses. A failed lookup is not cached, and it fails closed: the application is hidden for that call.
- **What the grant names.**
  - A bare name (`"mousepad"`) resolves once at boot through `PATH`, following every symlink, to `/usr/bin/mousepad`.
  - A snap's `PATH` entry resolves to the shared launcher `/usr/bin/snap`, so a snap name admits its own tree, `/snap/<name>/`, and never the launcher.
  - An explicit entry, `{"name": "tool", "executable": "/absolute/path"}` in the grants file, names the executable directly.
  - A name that resolves to nothing admits nothing.
- **Wire.** This adds the refusal code `ApplicationIdentityMismatch`, so it is schema version 1.28.0.
- **The gate.** `queryElements`, `discoverElements` and `focusedElement` apply the check where they apply the name check. An impostor is **absent** from unscoped answers, as an ungranted application is. A scope aimed at a granted name that only an impostor answers is refused as `ApplicationIdentityMismatch`, class `world`: the desktop holds a stranger wearing the name, and the caller asked correctly.
- **Where it does not apply.** In `"all"` visibility mode everything is visible anyway. Replay tapes answer with no identity and keep name-only behaviour. The CDP backend is not affected: its browser is the one the daemon launched (ADR-0119).

## Consequences

- **Interpreted applications** (a Python or shell GTK program) run `python3` or `sh`, not the script `PATH` finds. They are **hidden until the operator lists their executable explicitly**. That grants every program run by that interpreter under that name, and the grants file is where the operator accepts that.
- **Flatpak applications** run inside their own mount namespace. `/proc/<pid>/exe` reports the sandbox path (such as `/app/bin/...`), and no host `PATH` entry resolves to it. They are **hidden until the operator lists the executable explicitly**, and that path is not specific to one Flatpak. No Flatpak application was installed on the proof machine, so this is a stated, untested limitation: it fails closed, not open.
- Snap applications work with a bare name. On the proof machine Firefox is a snap.
- A real granted application is unaffected: the proof reads 330 elements from the real Mousepad with the check on.

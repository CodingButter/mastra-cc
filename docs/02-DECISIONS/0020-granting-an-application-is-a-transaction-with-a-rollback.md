# ADR-0020 — Granting an application is a transaction with a rollback

**Status:** accepted
**Date:** 2026-08-08
**Depends on [ADR-0019](0019-capability-is-not-authority.md).**
**Carried forward from the prototype's permission flow, with a rollback requirement added.**

## Context

The prototype's permission flow worked, and it is worth being precise about *why*, because the reason is not the part people usually copy.

Almost every system models a permission as a boolean: the user flips a toggle, a flag is stored, done. The prototype did something better. Granting an application in the dashboard was a **transaction** — it had preconditions, it had side effects on the machine, and it reported back what the user now had to do:

- The user goes to the permissions page deliberately and toggles a named application. Nothing is granted implicitly and nothing is granted in passing.
- For Chromium-family applications, the launcher entry is updated so the browser starts with renderer accessibility enabled.
- The user is told the application must be restarted, and the system knows whether it is currently running.

That shape is correct and it generalises, because permission to read an application is not a fact you record. It is a **state of the world you have to go and arrange**. The arranging differs per platform — which is exactly the capability half of [ADR-0019](0019-capability-is-not-authority.md), living below the seam from [ADR-0017](0017-platform-backends-live-inside-the-daemon.md).

What the prototype did *not* have is the other half of a transaction. It wrote a change to the machine and had no recorded, reversible way to take it back. That is two separate problems:

1. **It is a fact outside the repository.** [03-LESSONS.md](../03-LESSONS.md) §1 is an entire failure family about exactly this — a setup command in a Postgres column, a maintenance script in `~/bin`, a memory ceiling in a systemd unit. All three broke silently and no test in the tree could see them. A launcher entry rewritten at runtime by the daemon is the same species, and worse than the three examples, because it is written on a *stranger's* machine rather than ours.
2. **It breaks the promise the product is selling.** This system asks for extraordinary trust and pays for it with auditability. If a person revokes a permission — or uninstalls entirely — and we have left modifications on their machine, we have taken something we did not give back. No amount of good behaviour elsewhere survives that.

**One open question that may delete most of the Chromium machinery.** Chromium is understood to enable its accessibility engine when it detects an assistive-technology client on the accessibility bus, which would mean the daemon's mere presence is sufficient and the launcher flag is only a fallback. This is **belief, not confirmed** — it is scheduled as a pre-M1 spike in [07-ROADMAP.md](../07-ROADMAP.md) precisely because it can remove work rather than add it, and because [ADR-0010](0010-daemon-is-python-single-threaded-default-glib-context.md) rule 5 forbids inferring a capability we have not probed.

**On checking compatibility before launch.** A "check compatibility" button is desirable and we know of no honest mechanism for it. An application announces itself to the accessibility layer when it runs; before that there is nothing to ask. Guessing from the binary or the toolkit correlates weakly and would produce a confident wrong answer, which is the failure this project is organised against.

## Decision

1. **A grant is a transaction, not a flag.** It has preconditions, an effect, a verification step, and a report to the person about anything they must do — such as restarting a running application.
2. **A revoke is a rollback.** Every machine-side change made by a grant is recorded in an inventory, and revoking the permission undoes exactly those changes. Uninstalling runs the same rollback for every grant.
3. **Never modify a system-owned file.** Remediation writes user-level overrides that shadow system entries and are removable without trace. A grant that could only be satisfied by editing a system file is refused, and says so.
4. **The inventory lives where `infra/` can see it**, in a documented location, in a documented format — [ADR-0001](0001-machine-config-lives-in-the-repo.md) applied to state the product writes at runtime rather than state we ship. An untracked machine-side write is the failure family in [03-LESSONS.md](../03-LESSONS.md) §1 by another name.
5. **Remediation is per-backend**, declared by the platform backend as the answer to "what must be arranged before this application can be read". The transaction's *shape* is platform-independent; only its steps are not.
6. **Compatibility is observed, never guessed.** Applications that are permitted and running are probed, and the verdict is recorded per application with the time it was observed. An application never yet seen is reported as **unknown**, which is a first-class state and an honest answer. There is no pre-launch compatibility oracle, and we do not build one that guesses.
7. **A grant never triggers a launch.** Arranging capability may require the person to restart an application. It is theirs to restart.

## Consequences

**Good.** The trust story is complete in both directions: everything we do to a machine is recorded, reversible, and visible in the same place as everything else we did.

**Good.** "Unknown until observed" is a truthful state that costs nothing to implement and closes off a whole category of confident wrong answers, in keeping with [00-PRODUCT.md](../00-PRODUCT.md) §6 — *not a thing that pretends*.

**Cost.** An inventory is state, and state can drift from reality — a user may hand-edit or delete an override we believe we own. Rollback must therefore be defensive: verify before removing, and report rather than assume when the world does not match the record.

**Cost.** Requiring a restart is a genuinely poor moment in the experience, and there is no way to make it good. It is honest, which is the most that is available.

**Cost.** Observed-only compatibility means the permissions page shows "unknown" for applications the person has permitted but not yet run. That is less satisfying than a green tick and it is the only version of the tick we can actually stand behind.

## Evidence

| Claim | Source |
|---|---|
| deliberate per-application toggle; launcher updated; restart reported; running state known | prototype dashboard permission flow, as described by Jamie 2026-08-08 |
| facts outside the repository break silently | [03-LESSONS.md](../03-LESSONS.md) §1 — setup command in a database column, keeper in `~/bin`, memory ceiling in a unit file |
| machine configuration belongs in the repository | [ADR-0001](0001-machine-config-lives-in-the-repo.md) |
| capability is probed, never inferred | [ADR-0010](0010-daemon-is-python-single-threaded-default-glib-context.md) rule 5 |
| authority is checked before capability | [ADR-0019](0019-capability-is-not-authority.md) |
| remediation differs per platform | [ADR-0017](0017-platform-backends-live-inside-the-daemon.md) |
| the product does not pretend | [00-PRODUCT.md](../00-PRODUCT.md) §6 |
| Chromium may auto-enable on detecting an assistive-technology client | **unverified belief**; pre-M1 spike in [07-ROADMAP.md](../07-ROADMAP.md) |

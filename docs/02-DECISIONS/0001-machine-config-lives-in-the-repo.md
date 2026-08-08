# ADR-0001 — Machine configuration lives in the repository

**Status:** accepted
**Date:** 2026-08-08
**Supersedes:** the prototype's implicit practice of configuring hosts by hand

## Context

Three separate production incidents in the `computer-controls` prototype had the same shape: a fact the system depended on lived somewhere no test could see.

**Incident 1 — a setup command in a database column.** The build sandbox for every new agent ran a shell command stored in a Postgres column, `factory_project_repositories.setup_command`. When PR #227 renamed the top-level directories, that command still said `cd plugin`. Every new sandbox failed with `sh: 1: cd: can't cd to plugin`. Already-provisioned workers were unaffected, so the fleet **looked healthy while being structurally unable to grow**. Every gate in the repository passed. Nothing in the tree could have caught it.

**Incident 2 — a maintenance script in `~/bin`.** A cron job every fifteen minutes ran `~/bin/factory-keeper.sh`, an inline heredoc that re-woke any queued work younger than 24 hours. A pull request had replaced it with a careful, tested, gated version — but the replacement was never installed. For an entire evening the old script re-woke already-finished work every fifteen minutes, consuming capacity while the board looked busy. The claim "the re-dispatch loop is fixed" was true in code and false in production.

**Incident 3 — a memory ceiling in a unit file.** The service OOMed at roughly 4 GB three times. The fix — `NODE_OPTIONS=--max-old-space-size=12288` — lived in a systemd unit on one host. Nothing in the repository recorded that this ceiling was load-bearing, and nothing would have re-applied it on a fresh machine.

There is a fourth, subtler instance: the shim script that PR #225 *did* add to the repository was installed by symlink, and `BASH_SOURCE[0]` resolved through the symlink, so its computed repository root became `$HOME`. The documented install method could not work as written. Being in the repo is necessary but not sufficient — it also has to be *exercised the way it is installed*.

## Decision

**Every fact a machine needs in order to run this system lives in `infra/`, in the repository, applied by a checked-in script. If it is not in `infra/`, it does not exist.**

Specifically:

- Unit files, timers, and cron entries: `infra/systemd/`, `infra/cron/`.
- Sandbox and dev-container provisioning: a script at `infra/sandbox/setup.sh`. Any external system that needs a setup command is pointed at *that path*, never given an inline copy of its contents.
- Resource ceilings, environment variables, and version pins: declared in the unit files under `infra/`, with a comment naming the incident that motivated each one.
- One entry point, `infra/apply.sh`, that installs all of the above and is idempotent.

**Three supporting rules:**

1. **Scripts are installed by copy or by an explicit absolute path, never by a bare symlink** unless the script resolves symlinks when computing its own root. `apply.sh` is responsible for getting this right once.
2. **A rename PR must grep out-of-tree configuration for old paths before it merges**, and must prove itself by provisioning one fresh environment afterwards. A green test suite is not evidence here; a fresh provision is.
3. **Where an external system genuinely owns a value** (a hosted CI provider's job definition, a managed database's column), the repository holds the canonical copy plus a `tools/check-infra-drift.sh` that compares the live value against it and fails loudly.

## Consequences

**Good.** A fresh machine becomes reproducible. A rename cannot silently decapitate provisioning. The keeper-style "fixed in code, never deployed" gap becomes visible, because deployment is a script in the same pull request as the fix.

**Cost.** `infra/apply.sh` needs to be maintained and actually run, and there is a real temptation to hand-edit a unit file at 2 a.m. and forget. Mitigation: the drift check runs as a scheduled job, not only in CI, so a hand-edit is reported rather than discovered months later.

**Accepted limitation.** This does not solve secrets. Credentials still live outside the repository. `infra/` records *where* a credential lives and *what* it is for — never the credential.

## Evidence

| Claim | Source |
|---|---|
| setup command in a DB column, broken by rename | `factory_project_repositories.setup_command`; failure `cd: can't cd to plugin` observed 2026-08-07 18:38 |
| rename that broke it | PR #227 (179 files, 135 pure renames) |
| keeper fixed in code, never deployed | PR #225 merged; cron still running `~/bin/factory-keeper.sh` (mtime 2026-08-07 03:48) at 21:14 |
| old keeper re-woke finished work every 15 min | keeper log, `requeued (leased=… retry=…)` lines from 18:15 onward |
| fixed keeper's judgment once deployed | refused 31 of 34 rows the old script would have woken |
| OOM at ~4 GB, three occurrences | service logs, `FATAL ERROR: Reached heap limit` |
| symlink defeats `BASH_SOURCE` root computation | `bash -x` trace of the installed shim, 2026-08-07 21:16 |

# What the installable package does

## Question

Can a process that knows this repository only as a **published dependency** —
no workspace resolution, no source import, no relative path into this checkout
— drive a real desktop through a whole task, across a namespace boundary?

## Producer

```sh
bash infra/webtop/start.sh                          # a real KDE desktop with Kate
bash infra/webtop/installable-package/proof.sh
```

The harness packs `@mastra-cc/protocol-types`, `@mastra-cc/transport` and
`@mastra-cc/desktop` into tarballs, installs those tarballs into a scratch
project outside the workspace, and runs
[`drive-the-desktop.mjs`](../../infra/webtop/installable-package/drive-the-desktop.mjs)
there. That script imports `@mastra-cc/desktop` **by name**; the run prints
where the name resolved, and it resolves into the scratch project's
`node_modules`, not into `packages/`.

The daemon lives inside the container and is reached with `--ws-host 0.0.0.0
--ws-port 9977`. The host cannot see the container's filesystem, so the unix
socket is unreachable by construction and the websocket is the only door
([ADR-0058](../02-DECISIONS/0058-the-daemon-serves-one-protocol-through-two-front-doors.md)).

## Green

```
resolved from: /tmp/installable-package-proof/node_modules/@mastra-cc/desktop/dist/index.mjs
daemon: websocket listening on 0.0.0.0:9977
container address: 172.20.0.2

instructions: {"chars":3431,"firstLine":"# 11 — Agent instructions for the daemon"}
applications: ["kate"]
found: {"id":"el-935a7b1c4c7f","role":"text","name":"proof.txt"}
read-before: {"kind":"text","chars":0}
subscribed: {"subscriptionId":"sub-000001-68ceae"}
wrote: {"sentence":"INSTALLABLE PACKAGE PROOF 2026-08-30T23:52:37.832Z"}
verified: {"equal":true,"chars":50}
events: {"count":1,"kinds":["changed"],"attribution":["self"]}
unsubscribed: {"subscriptionId":"sub-000001-68ceae","ended":true}
{"proof":"green","elementId":"el-935a7b1c4c7f","sentence":"INSTALLABLE PACKAGE PROOF 2026-08-30T23:52:37.832Z","events":1}
```

The desktop agrees with the transcript:
[the screenshot](installable-package-desktop.png) shows that exact sentence, at
that exact timestamp, in Kate's own window.

Three things in that transcript are the point.

- **The instructions travelled with the package.** The `instructions` line is
  read from the installed tarball, not from this repository's `docs/`. An agent
  that installs the package is handed the text that tells it names are not
  identifiers and that a returned call is not proof the desktop changed.
- **The verification is a fresh read, not a return value.** `wrote` is a
  successful call; `verified` is the desktop being asked again and agreeing.
- **The event carried no content.** One `changed` event, attributed `self`, and
  the run fails if any event carries a `content` field.

## The refusal, kept

The first run of this script asked for `priority: "normal"`. The daemon
answered:

```
refused by the change stream: "priority" must be one of low, medium, high -
the daemon carries the label back unread, but it will not carry one the
schema does not define
```

That is recorded rather than tidied away, because it is the behaviour the
package promises: a refusal is an answer, it names the check that ran and what
would change it, and the package passes it through verbatim instead of
retrying, guessing, or repairing the caller's parameters.

## Red, at the merge base

```
$ ls /tmp/base-red/packages
transport

$ bash /tmp/base-red/infra/webtop/installable-package/proof.sh
bash: .../proof.sh: No such file or directory

$ (cd /tmp/base-red && pnpm --filter @mastra-cc/desktop build)
No projects matched the filters in "/tmp/base-red"
```

At `ddaf98d` there is no package to install, so there is nothing an agent
process could import by name.

## What this does not prove

The agent driving this desktop is **not cold**: it is the same session that
wrote the package. This proof shows the *published shape* works — the tarball,
the name resolution, the wire, the loop. It does not yet show that an agent
which has never seen this repository can pick the package up from its
instructions alone. That bullet of P1 stays open, and is reported open rather
than rounded up.

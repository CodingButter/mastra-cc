# Can an agent start an application nobody opened for it?

Until this change, no. `openApplication` could start exactly four programs — `yad`,
`chrome`, `gmail`, `qt6ct` — and everything else on the machine refused with
`launch: nothing can be launched by that name`, *before* permission was consulted. An agent
could only ever operate applications a human had already started. This proof is the
before-and-after of that, taken from a live desktop rather than argued.

## The command that produced it

```
bash infra/webtop/generic-launch/proof.sh
```

It packs the workspace tarballs, installs `@mastra-cc/desktop` into a scratch project
outside the repository, builds the daemon twice — once from this branch, once from a base
worktree at `7ae05a681a600b2de4001185e00300f9ebbf1df0` — and runs the same model-driven
errand against each, over WebSocket, against the real Webtop container. The only difference
between the two runs is which daemon build is on the other end of the socket.

The harness invokes no `xdotool`, `wmctrl` or `uinput`. That is the point: the agent starts
the applications itself, so nothing has to stand in for a human. Pin B8 still reports
exactly one human stand-in, and it is the signals proof, not this one.

| Artifact | What it is |
|---|---|
| [any-app-the-machine-has-without.txt](any-app-the-machine-has-without.txt) | The red. Base `7ae05a6`, same container, same errand |
| [any-app-the-machine-has-with.txt](any-app-the-machine-has-with.txt) | The green. This branch |

## The red

Against the base daemon, with permits held for both applications, the agent called
`openApplication("org.kde.kate")`, was refused, checked `listApplications` to see whether it
had the name wrong, and gave up:

> I was unable to open the text editor named "org.kde.kate" because `listApplications`
> reports that it is not launchable.

Two tool calls, zero readable roots, both errands refused. Chromium got the same
`nothing can be launched by that name`. That is the gap this plan exists to close, captured
as behaviour rather than as an assertion about a constant.

## The green

Same container, same errand, this branch's daemon:

| Application | Toolkit | Root observed after launch | Elements |
|---|---|---|---|
| `org.kde.kate` | Qt6 | `app-1c573c5ef1a2` (`kate`) | 0 → 500 |
| `org.xfce.mousepad` | GTK3 | `app-6b0712d04d54` (`org.xfce.mousepad`) | 500 → 500 |

Five tool calls, `PROOF: GREEN`. Neither application was running when the run started —
`roots-before-the-agent-ran: []` is the first line of both transcripts, and the harness kills
the container's pre-started Kate before capture.

Two toolkit families, deliberately. One application working would only prove that one of the
two accessibility knobs in the derived environment union does something; Qt6 and GTK3 both
working is what makes the union claim honest.

**The verdict is the readable root, not the element count.** Mousepad's launch grew the
global element census by nothing — 500 → 500 — because `queryElements` caps at 500 and Kate
alone saturates it. A verdict keyed on growth would have failed a launch that plainly
worked. The census is retained in the transcript as a logged measurement and is not the
criterion; the appearance of a readable application root that was absent before is.

## The number this moves

Measured in one container session, both daemons started identically, so the two counts are
comparable:

| Daemon | Desktop entries reported | Launchable |
|---|---|---|
| Base `7ae05a6` | 59 | 4 |
| This branch | 59 | 58 |

The one entry that still does not derive has no usable `Exec` after field-code removal — the
parser refuses rather than mangling, which is the designed behaviour.

An earlier Phase 0 probe against a differently-started daemon reported 127 entries and the
same 4 launchable. That session's `XDG_DATA_DIRS` was wider. The 59-entry pair above is the
one to quote, because both halves of it were measured the same way in the same session; the
127 is recorded here only so the discrepancy is not mistaken for drift.

## Boot cost

Deriving ~59 recipes from disk at startup, against the same daemon without it:

| Daemon | Ready after |
|---|---|
| Base `7ae05a6` | 0.671987887s |
| This branch | 0.674236044s |

One sample each, from the transcripts above. No threshold is asserted and none should be
read into this: two samples cannot separate a 2ms difference from noise, and the honest
statement is that the scan did not move boot time out of the same tenth of a second. The
dimension is reported because omitting it entirely would have been the dishonest option.

## The limitation, measured

Chromium launched through a derived recipe and never became readable:

> the application was opened but did not become readable within 10000ms - refusing to
> pretend it is ready

Zero roots, zero elements. This is not a surprise and it is not a bug in derivation — a
browser's readability is a CDP debugging port, not the accessibility bus. The hand-written
`chrome` and `gmail` recipes inject `--remote-debugging-port` and a non-default
`--user-data-dir` precisely because of this, and the CDP backend reads that one fixed
endpoint. A derived recipe sanitizes `Exec=chromium %U` into `["chromium"]` and adds the
toolkit environment union; nothing in it detects a browser, so no port is allocated and no
endpoint exists to read.

**No flag was invented to make this look better.** Generic Chromium and Electron launch is
recorded as a follow-up with three named blockers — family detection across wrapper scripts
and bundled runtimes, dynamic port allocation replacing the constant `9744`, and a
multi-channel CDP backend replacing the single endpoint. See ADR-0062 and the plan's
amendments file.

## One infrastructure deviation

The harness container runs with `apparmor=unconfined` (`infra/webtop/compose.yml`). Docker's
default AppArmor profile blocks bubblewrap's mount-propagation setup, which makes glycin —
GTK's image loader — abort while loading the Adwaita `image-missing.svg`, killing the GTK
process with exit 134. Every GTK candidate died that way, including the daemon's own
hand-written `yad` recipe, which is what proves the failure is the container and not this
change.

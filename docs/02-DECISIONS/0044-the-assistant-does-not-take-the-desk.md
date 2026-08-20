# 0044 — The assistant does not take the desk

Status: accepted, 2026-08-16 (pre-M3)

## Context

[ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) rule 7 says
*the person wins*, and until now that has meant one thing: if the user reaches
for a field the agent is working in, the agent yields. That is a rule about
**elements**, and it only applies once an agent is already acting on one.

There is a coarser way to lose the desk, and it happens before any element is
touched. Launching an application steals focus. The user is typing an email; the
assistant is asked to open something in the background; the new window comes up,
takes the keyboard, and the next sentence goes somewhere the user did not intend.
Jamie's observation, from watching it happen:

> *"the idea is that we don't steal focus… launching an application stores the
> current focus and then makes sure that focus gets set back even after launching
> an app. since i've seen launching an application steal focus."*

**Today the daemon does nothing about this.** `daemon/src/launch/spawn.ts:41-53`
spawns the recipe's argv, records the pid and resolves; there is no read of the
current focus and no restoration. A grep for focus-restoration behaviour across
`daemon/src` returns nothing — the only `focus` in the daemon is the *action
name* in the role tables. Whatever the desktop does with focus after a launch is
unmanaged, which means the assistant's answer to "open OBS" is currently "and
also, stop typing."

This is not a hypothetical politeness. It is the same class of harm as the
element rule: the person is doing something, and we interrupted it.

## Decision

**A focus change is an effect the user asked for, or it is a bug.**

**1. The distinction is intent, not mechanism.** `activate` is a real operation
class — [08-GLOSSARY.md](../08-GLOSSARY.md) defines it as *moving focus, raising
a window* — and when the user asks for a window to be raised, raising it is
correct. What is forbidden is focus moving as a **side effect** of an operation
the user asked for a different reason. "Open OBS" is a request to launch OBS. It
is not a request to be interrupted.

**2. Launch preserves focus by default.** Before spawning, the daemon records
what currently holds focus. After the launch settles, if focus has moved and the
launch was not itself an activate-class request, the daemon restores it. The
default is preserve; raising the launched window is something the caller asks
for explicitly.

**3. It is a tested behaviour, not an intention.** A launch that steals focus
fails a test. This clause exists because a rule with no failing test is a wish —
Family 4 of [03-LESSONS.md](../03-LESSONS.md) — and because focus stealing is
exactly the kind of regression that reappears quietly when a recipe changes.

**4. Restoration is honest about failing.** If the daemon cannot restore focus,
it says so — in the diagnostic on the response, and in the audit entry. It never
reports a clean launch when it left the user's keyboard somewhere else. A silent
best-effort here is worse than none, because the user cannot tell the difference
between "we protected your typing" and "we tried."

**5. The rule generalises beyond launch.** Any daemon-initiated operation whose
purpose is not to change focus must leave focus where it found it. Launch is the
first and most visible case; it is not a special case.

## Consequences

**Good.** The assistant becomes usable while the user is doing something else,
which is most of the time. Background work stays background. And the behaviour is
observable from outside — you can watch a launch happen and keep typing — which
makes it demonstrable on real hardware rather than assertable in a test only.

**Cost — the mechanism is not proven yet, and this ADR does not pretend it is.**
Reading and restoring focus is straightforward on X11. On Wayland, window
activation is largely compositor territory, and
[07-ROADMAP.md](../07-ROADMAP.md) §8 lists compositor-level access as
*deliberately deferred*. There are two candidate routes — the accessibility bus
(a `focus` action on the element that previously held it, which goes through the
application rather than the compositor) and a compositor protocol we have chosen
not to depend on. **Which one works, and on which session type, is a
measurement we have not taken.** It is taken in the milestone that implements
this, and the result is recorded with the command that produced it. If neither
route can restore focus on Wayland, the honest outcome is clause 4 firing every
time on that session type — a named limitation, not a quiet failure.

**Cost — "settled" needs a definition.** Focus after a launch is not a single
event; an application may take focus once, then take it again when its main
window finishes loading. A restore that runs too early loses to the second
grab. The settle window is a measured number, and picking it by feel is the
constant-tuning failure Family 6 warns about.

**Deferred.** Whether the user can turn preservation off — someone may genuinely
want launched windows to come to the front — is a configuration question, and
[ADR-0043](0043-an-element-publishes-its-own-actions.md) clause 4 already says
policy of that shape belongs to the user. The default is preserve.

## Evidence

| Claim | Source |
|---|---|
| the daemon does nothing about focus today | `daemon/src/launch/spawn.ts:41-53`; grep for focus-restoration behaviour across `daemon/src`: zero hits, 2026-08-16 |
| the person wins, at element granularity | [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) rule 7; prototype issues #4, #25 |
| `activate` is defined as moving focus or raising a window | [08-GLOSSARY.md](../08-GLOSSARY.md); [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) |
| launching an application steals focus in practice | Jamie, observed on his own desktop, 2026-08-16 |
| compositor-level access is deliberately deferred | [07-ROADMAP.md](../07-ROADMAP.md) §8 |
| a rule with no failing test is a wish | [03-LESSONS.md](../03-LESSONS.md) Family 4 |
| tuning a constant to hide an upstream inconsistency | [03-LESSONS.md](../03-LESSONS.md) Family 6 |

## Amendment — the measurement was taken (M2.7 segment 4, 2026-08-20)

The Consequences section above says the restoration mechanism *"is not proven
yet"* and that which route works, on which session type, *"is a measurement we
have not taken."* Both sentences are now history rather than status, and this
amendment records what the measurement said. The original text stands above,
unedited, in the manner of ADR-0008's struck-through rule 6: the reason the
question was open is part of the record.

**The measurement.** Taken twice, on real desks, with an independent witness
process reading the accessibility bus over its own connection — never the
daemon's answer:

- **X11 (GNOME on Xorg): the accessibility-bus route restores.** The raw call
  was measured in M2.7 segment 1 (`Component.GrabFocus` genuinely moved the
  keyboard, `.proof/segment-1/focus-x11.txt`), and the daemon's whole launch
  path was measured in segment 4: a dialog held the keyboard, the daemon
  launched qt6ct, and the witness read the keyboard back on the dialog
  afterwards, with no focus-preservation note in the launch's answer
  (`.proof/segment-4/focus-x11.txt`). On X11, clause 2 is a **tested,
  observed behaviour**, and the segment-4 demo fails if a launch on X11
  leaves the keyboard elsewhere — a disclosed failure there is a regression,
  not a limitation.
- **Wayland (GNOME): the route reports success and moves nothing.** Measured
  in M2.6 segment 3 and re-measured in M2.7 segment 4
  (`.proof/segment-4/focus-wayland.txt`): the launched application kept the
  keyboard, and the daemon said so in the launch's own diagnostic — clause 4
  firing every time, exactly as this ADR said the honest outcome would be.

**The narrowing.** The limitation named in Consequences is therefore
**Wayland-specific**. It is not "restoration is unproven"; it is "the
accessibility-bus route cannot win the keyboard back from a Wayland
compositor". The compositor-protocol route remains deliberately deferred
([07-ROADMAP.md](../07-ROADMAP.md) §8), and until it is taken, clause 4's
disclosure is the whole of the daemon's guarantee on Wayland sessions.

**The settle window, as built.** The restore runs after the launched
application becomes readable — the readable-poll inside `openApplication` is
the settle window, measured by the application's own appearance on the bus
rather than a tuned constant. The segment-4 X11 transcript shows the restore
winning after qt6ct's window was fully up; no second-grab loss was observed.

| Claim | Source |
|---|---|
| X11 route restores (raw call) | `.mastracode/plans/m2-7-the-daemon-is-finished.proof/../segment-1/focus-x11.txt`, M2.7 segment 1, bigbeast |
| X11 launch path restores end to end | segment-4 `focus-demo.sh`, X11 transcript, 2026-08-20 |
| Wayland route claims success, moves nothing | segment-4 `focus-demo.sh`, Wayland transcript, 2026-08-20; M2.6 segment 3 focus leg |
| a launch that steals focus fails a test | `daemon/src/__tests__/focus-preservation.test.ts`; mutation entry `a-launch-takes-the-focus-and-never-gives-it-back` |

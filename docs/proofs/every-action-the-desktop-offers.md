# Every action the desktop offers, measured

Produced 2026-08-18 on **minibeast** (Ubuntu 24.04, Wayland, GNOME) on real
hardware, closing **M2.6**. The applications exercised are `yad` (a GTK dialog,
read through the accessibility bus), `qt6ct` (a Qt settings application), and
headless Chrome (read through the browser protocol). The offline suite pins
every claim below; this document is the same claims witnessed live, with a
running desktop on the other side.

Three separate things are recorded here, in the order they were measured:
what the desktop lets us **do**, what it lets us **see**, and what it will
**not** let us do — the last being the part a milestone is most tempted to
omit.

## 1. The verbs act, and the verdict is never the daemon's

`.proof/demo.sh`, four legs, run against a `yad` dialog this repository did not
launch through the daemon — the daemon is found acting on an application it did
not start.

| Leg | What was done | How it was verified |
|---|---|---|
| `e` | Text typed into a real form field | An **independent witness** (`.proof/witness.mjs`) walked the accessibility bus in its own process, over its own connection, and read the string back |
| `a` | A checkbox flipped | The `checked` state re-read **from the tree**; the return value was never consulted |
| `r` | The same three verbs, from an unauthorised session | All three refused *before the call*; the field left byte-identical to leg `e` |
| `s` | The dialog committed | `yad` printed its own form values as it exited — the application's own dying words |

The verdict is the witness's, never the daemon's. **A daemon that reported a
write it never made would agree with itself perfectly.** The red side of this
pair runs the identical script against the previous daemon and fails at leg
`e`; the legs, the subject, the witness and the wire client are byte-identical
across both runs, and the only thing that differs is which daemon answers.

One correction is on the record rather than edited out: on its first run the
witness decoded the wrong state bit and contradicted the daemon. The daemon was
right and the witness was fixed. **The party that turned out to be wrong was
the witness — that is the mechanism working.**

## 2. Existence and permission are readable; content is not

`.proof/listing.sh` — the **exact inverse** of
[an unpermitted application is invisible](an-unpermitted-application-is-invisible.md),
measured on the same machine against the same application.

That earlier artifact is not superseded and is not being corrected. It remains
the true record of what M2 shipped, and of the property that still holds
everywhere except the listing. What changed is one disclosure, for one reason
([ADR-0042](../02-DECISIONS/0042-existence-is-readable-content-is-not.md)): an
application invisible in the *listing* did not leave a caller ignorant, it left
them believing the machine did not have it. **Invisibility does not produce
ignorance — it produces a false belief.**

A daemon started with **no permits and no grants file** answers, for a running
application it may not touch:

- The application is **present** in the listing — 130 entries, including it.
- All five capabilities are reported, and **every withheld one names the
  setting that would grant it**: `observe` → `the grants file (--grants)`,
  `launch` → `the session flag --permit <application>`, and each element verb →
  `the session flag --allow <capability>`.
- The same session querying that application's elements gets **zero elements**,
  in a response **byte-identical** to querying a name that never existed. The
  only differing bytes are the caller's own echoed request id.
- `openApplication` refuses, and the refusal **names `listApplications`** — a
  wall a caller can act on — while **not revealing whether the application is
  installed**.

Both halves are proven in one run against one daemon on purpose. A leg that
proved only the listing would have proved the disclosure without proving the
boundary that bounds it. **The fence is what makes the reversal safe.**

### What this leg caught

The first run of this leg failed, and the failure was real. `listApplications`
answered 127 entries and `yad` was **not among them** — while
`openApplication {"name":"yad"}` launched it on request. The listing enumerated
the machine's desktop entries alone, and `yad`, `chrome` and `gmail` ship no
`.desktop` file while having launch recipes.

The offline suite had not caught it because the fixture had been given a
`yad.desktop` of its own: the tested world was one where everything launchable
also had an entry, and the real machine is not that world. **A fixture that
grants the assumption under test is not a test.** Fixed in `dc7dfbc`, pinned by
three tests and the mutation `the-listing-forgets-what-this-daemon-can-launch`.

## 3. Focus: what was measured, and what could not be delivered

`.proof/focus.sh`, with an independent witness (`.proof/focus-witness.mjs`)
decoding the platform's own state constants rather than trusting the daemon's
reading of them. Three readings, each read back from the tree: before the
launch, immediately after, and after the restoration attempt.

**The instrument was wrong first, and the proof leg is what found it.**

The daemon originally read AT-SPI's `FOCUSED` bit and treated it as "what holds
the keyboard". Measured on this session, hands off, twice:

- `FOCUSED` is **per-application-local**. Four nodes across three applications
  published it simultaneously, and a dialog went on publishing it after a
  launch took its keyboard away — the bit never cleared.
- `ACTIVE` tracks the keyboard but is **not exclusive** on its own: a
  background browser window claimed it while holding no focused descendant.
- The **intersection** — a focused element underneath an activated ancestor —
  was exactly one in every census taken, and it **moved when the keyboard did**.

Watching the first bit alone, nothing ever moves, and a launch that stole the
keyboard looks clean. That is precisely what the daemon reported before
`2d463e7`: a clean launch, while the witness showed the keyboard had plainly
gone elsewhere. Green tests certified the broken version; the live leg did not.
The ancestor test is deliberately **role-agnostic** — a GTK dialog carries the
activation on a frame, `qt6ct` carries it on a `filler`, and keying it to
window-shaped roles answered "nothing holds focus" when tried.

### The named limitation (ADR-0044 clause 4)

**On this Wayland session, the restoration route does not work.**
`Component.GrabFocus` returns `true` and moves nothing — the same shape of lie
as `SetPosition`, reproduced on focus, on 6 of 20 measured controls. Measured,
not assumed, which is what
[ADR-0044](../02-DECISIONS/0044-the-assistant-does-not-take-the-desk.md) asked
for.

So the milestone's focus guarantee currently delivers **detect and disclose,
not restore**. A launch that moves the keyboard says so, in the launch's own
answer:

> the focus was not restored after this launch: `""` held it before the launch
> and `""` holds it now - this is not a clean launch, and the keyboard is
> somewhere the caller did not ask for

The leg's pass condition is that sentence appearing — **not** a successful
restore. A leg demanding a successful restore would fail on a platform
limitation the milestone deliberately named; a leg demanding nothing would be
the silent best-effort clause 4 exists to forbid. **A limitation named is the
deliverable; a limitation omitted is the failure this milestone exists to
correct.**

Winning the keyboard back on Wayland requires the compositor, which stays
deferred ([07-ROADMAP.md](../07-ROADMAP.md) §8). X11 is **unverified** — it was
not tested, and nothing is claimed about it.

## 4. Both lanes, and the tape

Both live lanes green, zero skipped, on this machine:

| Lane | Result |
|---|---|
| Browser protocol — headless Chrome 151, own profile and page server | 55 passed, 0 skipped |
| Accessibility bus — `MASTRA_CC_LIVE=1` conformance | 55 passed, 0 skipped |

The offline lane replays **recorded** elements carrying real action lists.
Nothing in the corpus was hand-authored; a tape records a tree it was captured
from, and `loadTape` refuses one that was written by hand.

**Tape drift, recorded rather than waved through:** the release-gate check
(`--verify-tape gtk-dialog`) reports 12 of 128 exchanges unchanged and 116
drifted. This is the desktop differing from the moment of capture — a different
set of applications was on the bus — not a defect, and it is reported here
because an undiscovered drift is the failure the check exists to catch. The
corpus was **not** re-captured for this milestone: the replay tests assert
against the tree the tape recorded, and re-capturing to make a number look
better would be changing the question.

## The limit of this result

One machine, one session type, one desktop environment, one run of each leg.
Wayland only. The byte-identical comparisons are exact for the constants this
daemon version emits. Two defects in this milestone's own work were found by
these legs *after* the offline suite was fully green, which is the strongest
statement this document can make about what green tests are worth on their own
— and the weakest possible claim about how many remain.

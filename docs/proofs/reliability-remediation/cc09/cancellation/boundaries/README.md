# CC-09 — boundaries inside single-call effects and the capture subprocess

```sh
pnpm exec turbo run build
node docs/proofs/reliability-remediation/cc09/cancellation/boundaries/demo.mjs
```

The [parent proof](../README.md) measured cancellation at the clear loop's per-key boundary and recorded the rest as open: a chord, a string and a press are one registry call each, and a screen grab is one subprocess, so none had a boundary and each acknowledged only on return. This closes that in the two ways that are honest.

**Before a single emission.** Every effect passes `boundary(0, 1)` at the last point where nothing is in flight: in `performing()` immediately before the effect, and for aimed raw input (`sendKeyChord`, `typeText`) again after the focus grab and immediately before the one emission, because the aim is inside the effect. A driver that closed while the request waited its turn, or while the aim was under way, is answered `stopped before its first emission ... nothing was sent`. Nothing can stop the registry call itself once made; that is not changed and not claimed - a driver that closes after the call is answered normally and the key is not retracted.

**At any point in a screen grab.** `run()` in `capture.ts` takes the connection's signal from the cancellation store: already aborted, no child is started; aborted mid-grab, the child is killed with SIGKILL and the grab rejects as `CancelledAtBoundaryError`, which `captureElement` rethrows rather than converting to a desk failure, so the server logs it as the acknowledgement it is. A grab is a look, not an emission - stopping it loses nothing that cannot be looked at again.

`with.txt` is the current tree: a real daemon over a real Unix socket, built artifacts, scripted registry so emissions can be counted, and a fake `xwd` that would sleep 30 s. A chord whose driver closed during the focus grab: zero emissions, daemon logs the pre-emission stop. A capture whose driver closed 50 ms in: stopped after 56 ms, not 30 s. A successor is then admitted and its chord is sent. `PROOF: GREEN`.

`without.txt` is the same demo against built `origin/master` (`faba459`): the chord aimed for the closed driver is sent anyway; RED at the first case.

Unit gates: `cancellation-is-acknowledged-at-a-boundary.test.ts` +3 (pre-emission stop for chord, text and press with zero emissions; a close after the call does not retract; `run()` killed mid-grab within the budget, refused when already asked, unchanged with no driver). Mutations `an-effect-begins-though-its-driver-asked-to-stop`, `a-key-is-sent-though-its-driver-asked-during-the-aim`, `the-screen-grab-outlives-its-driver`, `the-screen-grab-starts-though-its-driver-already-asked` are each caught.

Not claimed: chunking `emitString` into per-character calls (CC-02 pins exactly one emission per attempt; a boundary inside the string would trade that for partial text); a wire-level cancel verb (protocol scope); any change to the successor-admission timing already measured in the parent proof.

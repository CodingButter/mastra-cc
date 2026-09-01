# A key, addressed to one element

**What was claimed:** an agent can be granted the authority to send one named key chord to one
element it names, that authority is off until a person turns it on, it can never be reached as a
fallback from a semantic verb that was refused, and whether the key arrived is decided by reading
the desk back rather than by the reply.

**What was proven, on a real KDE desktop, driven through the wire:** all of it. A `Delete` sent to
a named element in a text editor removed exactly one character, and a second connection holding no
raw-input authority read the same document and saw the same change.

Harness: `infra/webtop/04-a-key-addressed-to-one-element/proof.sh`.
Transcripts: [without](04-a-key-addressed-to-one-element-without.txt) (base `2593e80`),
[with](04-a-key-addressed-to-one-element-with.txt).
Delivery measurement: [spike](04-a-key-addressed-to-one-element-spike.txt), rerunnable with
`infra/webtop/04-a-key-addressed-to-one-element/measure-delivery.sh`.

## Three daemons, one errand

A document holding `alpha`, the caret placed at the start semantically, and one named key.

| daemon | asked to send `Delete` to the document | the document afterwards |
|---|---|---|
| base `2593e80` | no such route on the wire | `alpha` |
| this branch, unarmed | refused: *"is rawInput-class and this session holds no rawInput authority … started without the session flag `--allow rawInput`"* | `alpha` |
| this branch, `--allow rawInput` | delivered | `lpha` |

The middle row is the segment's central claim, measured against a running daemon rather than read
off the source: **off by default, and the refusal names the flag that would change it.** The bottom
row is the capability itself, and the verdict on it was not the daemon's own answer — a second
client connected afterwards and read `lpha` independently (ADR-0047).

The file on disk still reads `alpha` in every row, which is the point: this is a proof about one
keystroke, not about saving.

## Where a synthesised key actually goes

The route emits on the accessibility registry, which underneath is a display-server test event.
It follows the display server's focus, and the accessibility layer's own notion of focus has no
vote. That is measured, not assumed —
[spike transcript](04-a-key-addressed-to-one-element-spike.txt):

| condition | the accessibility layer says | `Delete` |
|---|---|---|
| the editor's window is active | element focused | `alpha` → `lpha` |
| another window is active | element focus refused | `lpha`, unchanged |
| another window is active, after grabbing focus on the editor's window first | — | `lpha`, unchanged |

So a key addressed to one element lands when that element's window is the front one, and vanishes
otherwise — silently, because `GenerateKeyboardEvent` answers success either way. The daemon never
takes the reply as evidence: it focuses, emits, restores the focus it borrowed (ADR-0044), and
reads the element back, so a caller sees what the desk holds rather than what the bus claimed.
Raising a window is not something this daemon does on an agent's behalf, and this segment did not
add it.

## Two false findings, and what they were worth

Both are recorded because a proof that only lists its successes is an advertisement.

1. **"Non-printable chords do not deliver on this platform."** Wrong, and briefly shipped as a
   platform refutation. The measuring harness never actually put focus on a document — it typed
   into an editor's welcome screen, where a search box will accept a word and hand it back, which
   looks exactly like delivery until you ask a second connection.
2. **"There is no way to deliver a key here."** Also wrong, and the cause was one number: the
   synth-type constant was `1`, which is `RELEASE`, not `SYM`, which is `3`. The daemon was
   emitting the release of a key that had never been pressed. Every call returned success.

Both survived as long as they did for the same reason, and it is the reason this contract exists:
the interface reports success for a key that went nowhere. Nothing that presses a key may be
believed about whether it pressed one.

## The errand that motivated this, and where it went

Errand E2 of the desktop-literacy sweep — rename a file in the file manager — scored 0/3 both
before and after the agent instructions were rewritten (`docs/proofs/errands/`), because the inline
rename commits on Enter and the daemon had no Enter. It is not the demo here: the file manager in
this image publishes no rename on `F2` at all, through the accessibility layer or through a real
keyboard, so the errand is unreachable in this desktop for reasons that have nothing to do with
this capability. The editor errand above tests the same claim against a surface that can be read
back character by character, which is the stronger evidence anyway.

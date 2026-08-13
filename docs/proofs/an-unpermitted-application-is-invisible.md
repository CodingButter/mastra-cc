# An unpermitted application is invisible

Produced 2026-08-13 on **minibeast** (Ubuntu 24.04, Wayland), on real
hardware, on **both routes** — the accessibility bus (yad) and the browser
protocol (chrome). The offline suite has pinned this since M1
(`daemon/src/backends/__tests__/invisibility.test.ts`); this document is the
same claim witnessed live, with a running desktop on the other side.

The claim, precisely: deny-by-default means an unpermitted application is
**absent, not filtered**. There is no "blocked" notice, no redacted entry, no
refusal that names the application. A session that was not granted an
application cannot distinguish it from an application that has never existed.

## How it was shown

`.proof/invisible.sh` runs **two daemons against the same desktop at the same
moment**: a granted session (`--permit yad`, or `--permit chrome`) and an
ungranted one (no permits, no grants file). One wire client
(`.proof/invisible-client.mjs`) talks to both sockets and asserts every
conclusion — output is roles, ids, counts, booleans and refusal constants
only. The transcript is `.proof/invisible.txt`.

Per route, in order:

1. **The granted session proves presence.** `openApplication` launches the
   app; `queryElements` answers real elements (yad: 17 on the bus; chrome: 21
   through the browser protocol), each stamped with its route in the
   diagnostic (`mastra-cc/visibility-route`, ADR-0040) — `accessibility-bus`
   on one route, `browser-protocol` on the other.
2. **The ungranted session, same desktop, same moment, sees nothing.**
   `queryElements {}` answers **zero elements** while the app demonstrably
   runs. A query naming the running-but-ungranted app and a query naming
   `never-existed` answer **byte-identical full responses** — compared as the
   whole wire-shaped response, not just the elements array, so no diagnostic
   field can leak which name was real.
3. **Refusals do not leak existence.** `attestElement` and `subscribeElement`
   on a **real element id** (obtained by the granted session) refuse with the
   **full constant byte-identical** to the refusal for the nonexistent id
   `el-000000000000` — the only differing bytes are the caller's own echoed
   id, bytes the caller itself supplied.
4. **Changes happen; the ungranted session hears nothing.** With a granted
   watch established, the app is killed externally. The granted session
   witnesses the change — yad: elements 17 → 0; chrome: a **named refusal**
   (killing the browser kills the cdp instrument with it, and a dead
   instrument answers with `BACKEND_UNREADABLE`'s constant, never silence).
   The ungranted session received **zero events** across the entire run and
   still sees nothing afterwards.

## What was recorded, not asserted

- The granted watch heard no change events **before** the kill on either
  route: a static yad dialog emits no `Object.StateChanged`, and the fixture
  page was idle. The root-vanish event contract (`watchEnded`) is pinned by
  the offline suite (mutation `a-dead-root-is-silently-forgotten`) and by
  M2.4's committed demo — this leg's claim is invisibility, and it asserts
  only what it witnessed.
- On the browser route the watch anchored on the window element after the
  application root refused by name — the same anchor the Gmail proof used.

## Why absence, not filtering

A filtered entry — "an application exists here but you may not see it" — is
itself a disclosure: it tells an unpermitted session *that there is something
to hide*, and byte-level differences in refusals would tell it *which* names
are real. The daemon's constants are shaped so that ignorance and denial are
indistinguishable (ADR-0019, ADR-0034). This proof measures exactly that
property on live hardware: the byte-identical comparisons in steps 2 and 3
are the security property, witnessed rather than trusted.

One structural note the comparisons rely on: **refusals carry no `diagnostic`
subtree.** The visibility-route stamp (ADR-0040) rides only on element
answers, so it cannot perturb a refusal's bytes — the full-constant
comparisons above would catch it if it ever did, which is precisely why they
compare whole responses and not just the interesting fields.

## The limit of this result

One machine, one session type, two applications, one run each. The
byte-identical comparisons are exact for the constants this daemon version
emits; the zero-event witness covers the run's window, during which the
desktop demonstrably changed. No claim is made beyond them.

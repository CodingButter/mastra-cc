# ADR-0107: A press aimed from a picture names the picture

Date: 2026-09-17
Status: Accepted — CC-07 freshness contract; schema version 1.26.0. Closes the "no capture token or stale-image rejection" boundary that [ADR-0105](0105-a-picture-says-which-part-of-the-element-it-is.md) left open.

## Evidence

ADR-0105 made a picture say which part of the element it showed, and its adapter text told the model how to turn a place in the picture into the `x`, `y` fractions `clickElement` takes. What it could not say was whether those fractions still meant anything by the time the press arrived. The press is sent at the element's freshly read rectangle, which is right; but the fractions were chosen against the rectangle the picture was cropped from. If the element moved, resized, or was re-photographed between the look and the press, the press lands on whatever now occupies the place the model was looking at — and nothing in the answer says so. The remediation plan (CC-07) names this: a stale picture should be rejected before a click effect, not noticed afterwards.

## Decision

`clickElement` takes an optional `capturedAt`: the `capturedAt` of the picture the press was aimed from. When present, the daemon checks two things after reading the fresh rectangle and before sending anything:

1. It is the **latest** picture this daemon answered for that element. The daemon keeps one record per answered element — the newest picture's `capturedAt` and the desk rectangle it was cropped from — so an older `capturedAt` means the caller is aiming from something already superseded.
2. The element's fresh rectangle **equals** the one the picture was cropped from. Any difference in origin or size is the desk having moved under the picture.

Each refusal is a `PointerBlockedError` that names which of the two it was, so the caller knows to look again and aim from the new picture. A `capturedAt` this daemon never answered for the element is refused too: a claim the daemon cannot check is not a claim. A non-finite `capturedAt` is a caller error, refused as `UnperformableElementError`. Nothing is sent on any refusal.

Omitted, `capturedAt` claims no picture and the press is what it was under ADR-0078: aimed at the freshly read rectangle, with no promise about any picture. The adapter text next to every picture now tells the model to pass the value.

## What this does not claim

- The check is against the rectangle the daemon read, not against pixels. Content can change inside an unmoved rectangle; that is still the caller's to verify by read-back, as before.
- The record is per element and holds only the newest picture. Two captures in the same millisecond share a `capturedAt`; the second replaces the first, and both name the same rectangle, so nothing is lost.
- Fresh-rectangle reading and the press remain non-atomic. The window is narrowed to the daemon's own read-then-send, which is the narrowest this transport offers.

## Consequences

- Schema 1.26.0: additive optional `clickElement.params.capturedAt`. Golden fixtures regenerated; consumers on 1.25.0 are unaffected.
- Daemon keeps a bounded `pictured` map, one entry per answered element.
- Regression coverage: `daemon/src/__tests__/a-press-aimed-from-an-old-picture.test.ts`.

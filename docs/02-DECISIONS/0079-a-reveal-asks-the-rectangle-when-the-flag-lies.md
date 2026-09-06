# 0079 - A reveal asks the rectangle when the flag lies

Status: accepted
Date: 2026-09-05
Schema: 1.17.0

## Context

`revealElement` scrolls an element into view and then reads the world back to
see whether it worked, as every effect in this daemon does (ADR-0047). Its
read-back was a single state: a node that is visible in the tree but not
showing on the screen publishes `offscreen` (`daemon/src/backends/atspi/roles.ts`),
so a reveal that left `offscreen` set had, by the element's own account, done
nothing. Refusing there was the honest answer to the only witness available.

The witness turned out to be unreliable, and only on the surface that matters
most. Measured on Chromium during a wallpaper errand on 2026-09-05: an image on
a DuckDuckGo results page kept `offscreen` after `Component.ScrollTo` returned,
while `Component.GetExtents` published a rectangle sitting squarely on the
screen, and `clickElement` then pressed it successfully at that rectangle's
centre. The refusal was:

    bringing this element into view reported success, but reading the element
    back found "offscreen" where "on screen" was intended

The agent had done nothing wrong, the scroll had worked, and the element was
visible on the demo's video feed. `revealElement` was unusable on web content -
the one place an agent most needs it, because web pages are the one surface
where the thing you want is routinely below the fold.

## Decision

The state stays the first witness. When it still says `offscreen`, the
rectangle is asked as a second: an element publishing a rectangle with positive
width and height and a non-negative corner is showing, whatever the flag says.
Only an element that fails BOTH witnesses is refused. An element that publishes
no rectangle at all cannot testify and answers no, which preserves the previous
behaviour exactly for elements with no `Component` interface.

The rectangle is read as evidence about this reveal and is not published in the
result. Where on the screen something landed remains a promise about one
machine that this contract does not make - `clickElement` (ADR-0078) reads the
same rectangle for its own press, and neither method returns it.

## Consequences

The cost is a weaker claim. Before, a `revealElement` that returned meant the
platform itself said the element was showing. Now it can mean the platform said
otherwise and was contradicted by its own geometry. A desk where `GetExtents`
is stale in the same way `offscreen` is stale will report a successful reveal
of something a person cannot see, and this contract will have said so
confidently. That trade was made deliberately: a false success on a
mis-reporting platform costs the agent one wasted press, which it will observe,
while a false refusal cost every web-content reveal on Chromium.

A second cost: one more D-Bus round trip on the failing path, since the
rectangle is only asked for when the state says offscreen. The happy path is
unchanged.

Receipts: `daemon/src/backends/atspi/effects.ts` (`scrollIntoView`,
`showsOnScreen`), tests in
`daemon/src/__tests__/effects-are-observed.test.ts` ("refuses a reveal whose
element still sits above the screen", "answers a reveal whose element shows on
screen even when the state still says offscreen"), mutations
`a-reveal-that-believes-a-flag-over-a-rectangle` and
`a-reveal-that-takes-any-rectangle-for-a-place-on-screen`.

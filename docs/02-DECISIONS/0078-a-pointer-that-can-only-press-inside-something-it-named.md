# 0078 - A pointer that can only press inside something it named

Status: accepted
Date: 2026-09-04
Schema: 1.17.0

## Context

This contract has refused a pointer since the beginning, and the refusal was
right for the reason it was made: a method that takes a screen coordinate
presses a PLACE. A daemon that presses places cannot name what it pressed
afterwards, cannot attribute it, cannot refuse it by application, and cannot
tell a person what it did except by showing them a picture of the screen. Every
grant in this product is a grant over a THING, so a verb that takes two numbers
is outside the permission system rather than inside it.

What broke the deadlock was not an argument. It was a wallpaper.

Plasma's wallpaper chooser publishes its images as list items that this desk can
see, name, scope, count and bound - and that publish `actions: []`. There is
nothing to activate. Focusing the enclosing list and pressing arrow keys and
`Enter` changes nothing in the tree, measured, and so does the same sequence
sent as real X keys, so this is not a synthesis problem. The `Apply` button
beside them stays without the `enabled` state until a selection exists that no
accessible operation can make. The same shape appeared twice more in one
afternoon: a file dialog whose entries offer `SetFocus` and no selection, and a
browser image that is a picture rather than a control.

An agent whose only road is "perform an action the element advertised" has one
road, and these desks are where it ends. The honest reading of three consecutive
dead ends is not that the desks are wrong. It is that a desktop is a place where
some things are done with a pointer, and a product that means to survive
anything thrown at it needs several ways to succeed rather than one that can
fail.

## Decision

Schema 1.17.0 adds `clickElement`, and it is a pointer that cannot express a
place on a screen.

1. **It takes an element, never a coordinate.** The parameters are an id this
   daemon has already answered for, a button, a count of one or two, and two
   fractions. No number crossing the wire is a screen pixel. There is no method
   here that moves a pointer to an arbitrary point, and adding one would undo
   this record rather than extend it.

2. **The rectangle is read at the moment of the press, from the platform.** Not
   remembered from the answer that produced the id: a remembered rectangle is a
   press aimed at where something used to be. The point pressed is the element's
   own origin plus its own width and height times the caller's fractions.

3. **A thing with no place is refused, never defaulted.** No `Component`
   interface, a reply that is not a rectangle, a rectangle of zero area, or one
   whose computed point is off the screen: all refused before anything is sent.
   Clamping an off-screen point onto the desk would press whatever is at the
   edge and report it as this element, which is precisely the lie the
   no-coordinates rule exists to prevent.

4. **Fractions outside the element are refused, not clamped**, for the same
   reason: `x: 1.5` names a point on a neighbour.

5. **It is `rawInput`-class**, off unless a person started the session with
   `--allow rawInput`, and its implementation lives in the fenced raw-input
   directory pin B8 contains. A synthesised press is device synthesis whichever
   device it is, and putting it in `activate` class would have let a session
   granted "press the buttons this application published" also press anywhere
   inside anything it can see.

6. **Nothing falls back into it.** An `activateElement` refused for want of a
   published action does not become a click. The element that publishes no
   action has told the CALLER that a decision is needed; a daemon making that
   decision quietly is the fallback ADR-0046 clause 3 forbids. Asserted by a
   source check, as the raw-input verbs are.

7. **No focus is borrowed and none is restored.** A press is how focus moves on
   a desk. Grabbing focus first would make the press land on something the
   daemon pulled to the front a moment earlier, which is not what was asked for
   and not what a person's click does.

8. **The read-back is the evidence, and it is weaker here than elsewhere.** The
   platform answers `()` to a press that landed and to one that vanished, the
   same as the keyboard route, so the element as it reads afterwards is
   something to compare against an expectation - never a claim that the press
   did what the caller wanted.

## Consequences

The agent gains a second road to any element it can see, and the wallpaper grid,
the file dialog list and the browser image all become reachable without the
product learning to click places.

What this record does not do is open the screen. Nothing here screenshots, and
nothing here presses a coordinate. The natural next members of this family - a
picture of ONE element's rectangle, a drag from one element to another - inherit
the same rule and will be argued on their own merits: everything is addressed to
something the daemon named, so that whatever it did, it can say what it did it
to.

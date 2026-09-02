# 0068 — The name a person types and the name the desk prints are the same application

**Status:** accepted
**Date:** 2026-09-02
**No schema change.** The wire contract stays at 1.12.0; the ambiguity refusal is a new
sentence inside an existing refusal class.

## Context

One installed application answers to several names, and the daemon has known this since
the running census learned to match: an entry's normalised id, its catalog `appears-as`
translation, its final dot-segment, and the `Name=` label the machine wrote are all
derived from the entry itself and matched against what the accessibility tree prints
(ADR-0063's discipline — read the entry, never guess from a table of known applications).

Permits and grants did not know it. `--permit` and `--grant` matched the normalised exact
id and nothing else, so a person permitting `org.kde.kate` had not permitted `kate`, and
the demo's bring-up script permitted and granted **every** catalog entry twice — full id
and final dot-segment — to cover both readers. A bring-up script compensating for the
daemon is the bug report: the daemon held two beliefs about what one application is
called, and made its operators reconcile them by hand.

## Decision

Permits and grants resolve through the same entry-derived candidate names the census
reads, with one deliberate exclusion, through one shared index built the way the listing
already built its union (scanned desktop entries first, catalog-only recipe keys as
synthetic entries, ids never overwritten).

1. **The candidates are the entry's own real identifiers**: normalised id, catalog
   `appears-as` translation, final dot-segment. The `Name=` display label stays a
   **census-only** candidate. A wrong census match degrades to `cannot-tell` and costs a
   reading; a wrong permission match launches or exposes the wrong application — and the
   label is exactly where a real desk collides. Measured on the live demo inventory
   (`tools/candidate-collisions.mjs`, 2026-09-02): 16 material collisions, 13 of them
   pure `Name=` label collisions; excluding the label from permission leaves 2, both
   internal helper entries (`killer`, `urlhandler`) no operator permits by short name.

2. **Exactly one claimant resolves.** A name exactly one entry claims resolves to that
   entry, and the entry is authorised if **any** of its own candidates is permitted (or
   granted, for observation). `--permit org.kde.kate` covers a request for `kate`, and
   `--permit kate` covers a request for `org.kde.kate`.

3. **An exact full id is never ambiguous.** Derived recipes routinely put a sibling's
   name inside another entry's candidates — `chrome` and `gmail` both appear as `chrome`
   — and a rule that let a sibling's `appears-as` make the real entry's own id
   unreachable would refuse launches that work today. The union keys entries by
   normalised id, so at most one entry can claim a name exactly; only derived claims can
   contend.

4. **A contested derived name authorises nothing, in both directions.** A *request* by a
   name two entries claim is refused — the gate does not pick, exactly as the census
   degrades a contested runtime match to `cannot-tell` rather than flipping a coin. And
   a contested name cannot *carry* authority: `--permit chrome` does not authorise gmail
   through the shared `appears-as`. This change widens which **names resolve to** an
   entry; it never widens how many entries one configured name covers.

5. **An enumerated desk that claims nothing by a name refuses without consulting the
   permits.** Known-empty is not unavailable: the inventory was read and does not publish
   the name, so a permit naming it authorises nothing. Only a backend that **cannot
   enumerate** (`InventoryUnsupportedError`) keeps the old exact-name check — with
   nothing to resolve against, degradation to the historical behaviour loses no launch
   the daemon could ever do.

## This is not purely widening

The ambiguity rule can **refuse an exact name that was accepted before**. An operator who
permits `kate` on a desk where a second installed entry's final dot-segment is also
`kate` was previously launching whichever application the catalog happened to name; now
the request refuses and the refusal says to use the full id. That narrowing is the
point — an exact-match permit pointing at two different applications is not
authorisation, it is a coin flip — but it is a behaviour change an operator can hit, and
this record says so rather than presenting the decision as strictly additive.

## Boundary

This changes which names **resolve to** an entry. It does not change which entries a
configuration authorises, what `observe` grants, or what the backends expose:
`grants.ts` and every backend `isVisible` call site are untouched, because those key on
runtime tree names during enumeration, and widening them would change what the desk
exposes — which collides with the deny-by-default posture and the deliberate invisibility
of applications a person launched by hand.

## Evidence

- `apps/desk-demo/desk-up.sh` double-permitting and double-granting every entry (deleted
  in the same change).
- The Segment 00 smoke proof: a daemon permitting `kcalc` reporting `org.kde.kcalc` as
  `launch` disabled by `--permit <application>` — the workaround's failure captured live.
- The candidate-collision measurement on the live demo inventory
  (`tools/candidate-collisions.mjs`).

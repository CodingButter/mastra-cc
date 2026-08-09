// Throwaway. The stored workflow and its durability ladder.
//
// A recorded workflow cannot store element identifiers. In the prototype
// `get_id()` was not unique — Chrome's three frames all reported 32 — and real
// identity was the owning application's bus name plus object path, which
// changes on every launch. So a workflow stores re-resolvable PREDICATES,
// ordered by durability:
//
//   1 meaning   role plus name           survives a redesign
//   2 relation  role within an ancestor  survives reflow and renaming
//   3 position  role plus index          breaks on any addition
//   4 literal   the identifier itself    dead on restart; tiebreaker only
//
// Matching at a lower rung than last time is DRIFT: the thing still exists and
// its address changed. Drift is repaired silently and recorded — it is
// maintenance, not failure. Nothing here calls a model.

/** Record a workflow from a plan and the elements a live run actually
 *  resolved. The ladder is built from observation, not written by hand. */
export const recordWorkflow = (plan, resolvedByStep) => ({
  id: plan.id,
  metadata: { recordedAt: 'spike' },
  steps: plan.steps.map((s) => {
    const el = resolvedByStep.get(s.id);
    return {
      ...s,
      locators: el
        ? [
            { rung: 'meaning', predicate: { role: el.role, name: el.name } },
            {
              rung: 'relation',
              predicate: {
                role: el.role,
                withinAncestor: el.ancestry?.filter((a) => a.name)?.slice(-1)[0] ?? null,
              },
            },
            { rung: 'position', predicate: { role: el.role, index: 0 } },
            { rung: 'literal', key: el.key },
          ]
        : null,
    };
  }),
});

/**
 * Resolve a stored workflow against the interface as it is NOW, repairing
 * rung-1 locators that have drifted. Returns a plan the model-free interpreter
 * can run, plus telemetry about which rung each step matched at.
 *
 * @returns {{plan: object, rungs: object[], repaired: string[], unresolved: object[]}}
 */
export const replay = async (workflow, surface) => {
  const rungs = [];
  const repaired = [];
  const unresolved = [];
  const steps = [];

  for (const s of workflow.steps) {
    // Steps scoped to an earlier step keep their predicate — the interpreter
    // resolves those relationally at run time and a stored ladder would only
    // duplicate it.
    if (!s.locators || s.predicate?.within) {
      steps.push(s);
      continue;
    }

    let matchedRung = null;
    let element = null;
    let ambiguousAt = null;

    for (const loc of s.locators) {
      if (loc.rung === 'literal') break; // never resolve BY the identifier
      let hits = [];
      if (loc.rung === 'meaning') {
        hits = await surface.query(loc.predicate);
      } else if (loc.rung === 'relation') {
        if (!loc.predicate.withinAncestor) continue;
        const anc = loc.predicate.withinAncestor;
        const all = await surface.query({ role: loc.predicate.role });
        hits = all.filter((n) =>
          (n.ancestry ?? []).some((a) => a.role === anc.role && a.name === anc.name),
        );
      } else if (loc.rung === 'position') {
        const all = await surface.query({ role: loc.predicate.role });
        hits = all.slice(loc.predicate.index, loc.predicate.index + 1);
      }

      if (hits.length === 1) {
        matchedRung = loc.rung;
        element = hits[0];
        break;
      }

      // A rung that matches MORE than one thing halts the ladder; it does not
      // descend it. This distinction was found by measurement, not reasoning,
      // and it is the difference between a repair and a silent lie:
      //
      //   0 hits  — the ADDRESS moved. A lower rung is a legitimate way to
      //             find the same thing by a different description.
      //   2+ hits — the IDENTITY is unclear. A lower rung cannot clarify which
      //             one was meant; it can only disguise the guess as a match.
      //
      // Measured: renaming the entry point and inserting a second link made the
      // relation rung ambiguous. The ladder descended to position, took index
      // 0 — the newly inserted "Settings" link — and wrote that back as the
      // repaired rung-1 locator. Confidently wrong, with no trace of guessing.
      //
      // The position rung is the trap, because slicing an index ALWAYS yields
      // exactly one candidate. It can never be ambiguous, so it can never be
      // refused, so it always "succeeds" — which is precisely why it must never
      // be reached by falling past an ambiguous rung above it.
      if (hits.length > 1) {
        ambiguousAt = { rung: loc.rung, candidates: hits.map((h) => ({ role: h.role, name: h.name })) };
        break;
      }
    }

    if (!element) {
      unresolved.push({ ...s, ambiguousAt });
      steps.push(s);
      rungs.push({
        step: s.id,
        rung: null,
        why: ambiguousAt
          ? `ambiguous at ${ambiguousAt.rung}: ${ambiguousAt.candidates.map((c) => JSON.stringify(c.name)).join(' vs ')}`
          : 'no rung matched',
      });
      continue;
    }

    rungs.push({ step: s.id, rung: matchedRung });

    if (matchedRung !== 'meaning') {
      // Drift repair: re-derive the rung-1 locator from what was actually
      // found and write it back, so the NEXT run matches at the top rung
      // again. Without the write-back the cost never returns to baseline and
      // the recovery curve stays flat.
      //
      // Guarded deliberately: repair silently only when the role is unchanged.
      // A different role wearing the right name is a different thing, and that
      // is a question for a human rather than a repair.
      const before = s.locators.find((l) => l.rung === 'meaning');
      if (before.predicate.role === element.role) {
        before.predicate = { role: element.role, name: element.name };
        repaired.push(s.id);
      }
    }

    steps.push({ ...s, predicate: { role: element.role, name: element.name } });
  }

  return { plan: { ...workflow, steps }, rungs, repaired, unresolved };
};

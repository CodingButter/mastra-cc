// Throwaway. The interpreter.
//
// This file must contain NO model call, no agent, no LLM. That is the phase's
// load-bearing property and it is checked mechanically by no-model-check.mjs,
// not by reading. If executing a plan requires a language model, the plan was
// underspecified and the workflow learned nothing.
//
// Three behaviours are the point of this file:
//
//   record-and-refuse — run the whole plan, emit every intended effect, cause
//                       none of them. This is what derives the permission
//                       manifest, and it must work with gating switched off,
//                       because its value is replayability rather than consent.
//
//   refuse on ambiguity — a predicate matching two elements is never resolved
//                       by taking the first. That is the machine pretending.
//                       Return both with enough context to tell them apart.
//
//   suspend and resume — stop at the moment uncertainty arises, carry the
//                       resolved state across the pause, and continue on an
//                       answer. Not batching questions up front, and not
//                       discovering the problem afterwards.

import { RUNGS } from './plan.mjs';

export class Ambiguous extends Error {
  constructor(stepId, candidates) {
    super(`step ${stepId}: predicate matched ${candidates.length} elements`);
    this.name = 'Ambiguous';
    this.stepId = stepId;
    this.candidates = candidates;
  }
}

export class Suspended extends Error {
  constructor(stepId, question, state) {
    super(`step ${stepId}: ${question}`);
    this.name = 'Suspended';
    this.stepId = stepId;
    this.question = question;
    this.state = state;
  }
}

/**
 * @param {object} plan
 * @param {object} surface   the thing that can actually look at and touch a
 *                           page. Injected so the interpreter can be run
 *                           against a real browser or a fixture unchanged.
 * @param {object} [options]
 * @param {boolean} [options.dryRun]   record intended effects, cause none
 * @param {object} [options.answers]   answers to questions asked previously
 * @param {object} [options.resumeFrom] state carried across a suspension
 */
export async function interpret(plan, surface, options = {}) {
  const { dryRun = false, answers = {}, resumeFrom = null } = options;

  // Resolved elements survive a suspension. What the resumed run has to
  // re-derive is a cost paid on every question the assistant asks, so it is
  // measured rather than assumed.
  const resolved = new Map(resumeFrom?.resolved ?? []);
  const rederived = [];
  const intendedEffects = [];
  const observedEffects = [];
  const rungsUsed = [];
  const log = [];
  const startedAt = resumeFrom?.completedSteps?.length ?? 0;
  const completedSteps = [...(resumeFrom?.completedSteps ?? [])];

  const scopesTouched = new Set();

  const finish = (extra = {}) => ({
    log,
    intendedEffects,
    observedEffects,
    rungsUsed,
    rederived,
    // DERIVED, not declared. Nothing in plan.mjs writes this.
    manifest: {
      scopes: [...scopesTouched].sort(),
      elements: [...resolved.values()].map((e) => ({ role: e.role, name: e.name })),
    },
    completedSteps,
    truncatedAt: null,
    ...extra,
  });

  for (let i = startedAt; i < plan.steps.length; i++) {
    const s = plan.steps[i];

    // Resolve the target, if the step has one.
    let target = null;
    if (s.predicate) {
      const within = s.predicate.within ? resolved.get(s.predicate.within) : null;
      if (s.predicate.within && !within) {
        // The step depends on something a previous step resolved and we no
        // longer have it. Re-deriving is legal but it is a cost, so it is
        // recorded rather than hidden.
        rederived.push(s.predicate.within);
      }
      const matches = await surface.query({ ...s.predicate, within });

      if (matches.length === 0) {
        // In a dry run this is expected rather than exceptional, and it is the
        // honest limit of record-and-refuse: a refused click never reveals what
        // the click would have revealed, so every step downstream of a
        // materialising effect is unreachable. The run stops and says how far
        // it got instead of pretending the rest does not exist.
        if (dryRun) {
          log.push({ step: s.id, outcome: 'unreachable (downstream of a refused effect)' });
          return finish({ truncatedAt: s.id });
        }
        log.push({ step: s.id, outcome: 'not-found' });
        throw new Error(`step ${s.id}: predicate matched nothing`);
      }

      // Position is a legal rung but the LOWEST useful one, so an explicitly
      // positional predicate narrows after matching rather than instead of it.
      let candidates = matches;
      if (s.predicate.position === 'first' && candidates.length > 1) {
        candidates = [candidates[0]];
      }

      if (candidates.length > 1) {
        // Never take the first. Hand back everything needed to ask a human a
        // natural question about which one they meant.
        throw new Ambiguous(
          s.id,
          candidates.map((c) => ({
            role: c.role,
            name: c.name,
            ancestry: c.ancestry ?? [],
            window: c.window ?? null,
          })),
        );
      }

      target = candidates[0];
      resolved.set(s.id, target);
      rungsUsed.push({ step: s.id, rung: target.matchedRung ?? RUNGS[0] });
    }

    // Anything that leaves a mark declares its intent before doing it.
    if (s.class !== 'observe') {
      scopesTouched.add(s.class);
      for (const e of s.effects) {
        intendedEffects.push({ step: s.id, effect: e, class: s.class, target: target?.name ?? null });
      }
    }

    if (dryRun && s.class !== 'observe') {
      // The whole point: the effect list is complete, the effects are not real.
      log.push({ step: s.id, outcome: 'refused (dry run)' });
      completedSteps.push(s.id);
      continue;
    }

    // A step may need something only a human knows. Suspend HERE, mid-plan,
    // carrying the resolved state — not by collecting questions in advance.
    if (s.needs && answers[s.needs] === undefined) {
      throw new Suspended(s.id, s.question ?? `need ${s.needs}`, {
        resolved: [...resolved],
        completedSteps,
      });
    }

    const before = await surface.snapshot();
    const result = await surface.act(s.verb, target, {
      ...s,
      value: s.needs ? answers[s.needs] : s.value,
    });
    const after = await surface.snapshot();

    // What actually changed, taken from the surface rather than from the
    // plan's claims about itself.
    for (const change of diff(before, after)) observedEffects.push({ step: s.id, ...change });

    if (s.awaits?.appears) {
      const appeared = await surface.waitFor(s.awaits.appears);
      if (!appeared) {
        log.push({ step: s.id, outcome: 'materialisation-timeout' });
        throw new Error(`step ${s.id}: awaited element never appeared`);
      }
    }

    log.push({ step: s.id, outcome: 'ok', value: result ?? null });
    completedSteps.push(s.id);
  }

  return finish();
}

function diff(before, after) {
  const out = [];
  const b = new Map(before.map((e) => [e.key, e]));
  const a = new Map(after.map((e) => [e.key, e]));
  for (const [k, v] of a) {
    if (!b.has(k)) out.push({ change: 'appeared', role: v.role, name: v.name });
    else if (b.get(k).value !== v.value)
      out.push({ change: 'value-changed', role: v.role, name: v.name });
  }
  for (const [k, v] of b) if (!a.has(k)) out.push({ change: 'disappeared', role: v.role, name: v.name });
  return out;
}

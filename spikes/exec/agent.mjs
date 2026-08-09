// Throwaway. The half Phase 3 deliberately left out.
//
// Phase 3 built an interpreter with no model in its execution path and gave it a
// hand-authored plan. If Phase 4 simply re-ran that, every run would score zero
// tokens and the improvement thesis would be untestable — there would be nothing
// to save, because nothing was being discovered.
//
// So this is the thing that gets cheaper: an agent given the task in plain
// language, which must look at the interface and author the plan. The
// interpreter remains model-free and unchanged.

import { extractJson } from './model.mjs';
import { step } from './plan.mjs';

const SYSTEM = `You author PLANS for a non-model interpreter that automates user interfaces.

A plan is data. The interpreter executes it with no language model available, so
anything you cannot express as a resolvable predicate is lost.

Reply with JSON only:
{"steps":[{"id":"...","verb":"click|resolve|read|scroll","class":"observe|reveal|edit|transmit",
  "predicate":{"role":"...","name":"...","within":"<id of an earlier step>","position":"first"},
  "effects":["..."],"awaits":{"appears":{"role":"...","name":"..."}}}]}

Rules:
- A predicate is {role, name} and optionally within/position. Never a sentence.
- "within" refers to an EARLIER step's id, which scopes the search inside that element.
- class "observe" causes nothing; "reveal" rearranges what is visible; "transmit" cannot be undone.
- A step that reveals new content must declare awaits.appears for what it expects.
- Use the roles and names given to you verbatim. Do not invent elements.`;

/** A compact view of what is on screen. The agent gets roles and names, not
 *  markup — the same vocabulary the daemon would hand a real agent. */
const describe = async (surface) => {
  const nodes = await surface.query({});
  const useful = nodes.filter(
    (n) => !['none', 'generic', 'InlineTextBox', 'StaticText', 'ListMarker'].includes(n.role),
  );
  return useful
    .slice(0, 60)
    .map((n) => `- role=${n.role} name=${JSON.stringify(n.name)}`)
    .join('\n');
};

/**
 * COLD: no stored workflow. The agent must look, and look again after the
 * interface materialises, because content that does not exist yet cannot be
 * planned against. That second look is the expensive part a warm run skips.
 */
export const planCold = async ({ model, surface, task }) => {
  const before = await describe(surface);

  const first = await model.ask(
    SYSTEM,
    `Task: ${task}\n\nWhat is on screen now:\n${before}\n\n` +
      `Give the plan up to and including the step that reveals the message list. ` +
      `You cannot yet see what appears after that.`,
  );
  const opening = extractJson(first);

  // Materialisation: the agent has to cause the reveal before it can plan the
  // rest, which is why a cold run costs two model calls and a warm run costs
  // none. This is the cost the thesis claims is recoverable.
  const link = (await surface.query(opening.steps[0].predicate))[0];
  if (link) await surface.act('click', link, opening.steps[0]);
  await new Promise((r) => setTimeout(r, 400));
  const after = await describe(surface);

  const second = await model.ask(
    SYSTEM,
    `Task: ${task}\n\nThe list has now appeared. What is on screen:\n${after}\n\n` +
      `Give the REMAINING steps that read the answer. Use within/position to reach ` +
      `the first message's heading. Do not repeat the step that opened the list.`,
  );
  const rest = extractJson(second);

  return toPlan(mergeBatches(opening.steps, rest.steps));
};

/**
 * Two model calls each number their steps from one, so the second batch
 * silently collides with the first. Duplicate ids are not cosmetic: steps are
 * addressed by id, `within` resolves by id, and the recorded workflow keys its
 * elements by id — so a collision makes one step's resolution quietly stand in
 * for another's.
 *
 * Found in the rung telemetry, which reported the same step id twice in one
 * run. It would not have been visible in the table.
 */
export const mergeBatches = (first, second) => {
  const taken = new Set(first.map((s) => s.id));
  const renamed = new Map();
  const fixed = second.map((s) => {
    if (!taken.has(s.id)) {
      taken.add(s.id);
      return s;
    }
    let candidate = `${s.id}-b`;
    for (let n = 2; taken.has(candidate); n++) candidate = `${s.id}-b${n}`;
    taken.add(candidate);
    renamed.set(s.id, candidate);
    return { ...s, id: candidate };
  });
  // A `within` pointing at a renamed step has to follow it, or the scope
  // silently reattaches to the first batch's step of the same name.
  return [
    ...first,
    ...fixed.map((s) =>
      s.predicate?.within && renamed.has(s.predicate.within)
        ? { ...s, predicate: { ...s.predicate, within: renamed.get(s.predicate.within) } }
        : s,
    ),
  ];
};

/** Turn a model's JSON into the real plan type. This is where an underspecified
 *  plan is caught: step() throws on a prose predicate, so the rule is enforced
 *  by the type rather than by review. */
export const toPlan = (rawSteps) => ({
  id: 'read-most-recent-subject',
  metadata: { derivedManifest: null },
  steps: rawSteps.map((s) =>
    step({
      id: s.id,
      verb: s.verb,
      class: s.class,
      predicate: s.predicate,
      effects: s.effects ?? [],
      awaits: s.awaits,
    }),
  ),
});

/**
 * A plan that failed to resolve is handed back to the agent with what it
 * actually found. This is the re-planning cost after the interface changes, and
 * it is the number the recovery curve is made of.
 */
export const replanAfterDrift = async ({ model, surface, task, brokenStep }) => {
  const seen = await describe(surface);
  const reply = await model.ask(
    SYSTEM,
    `Task: ${task}\n\nA stored plan stopped working. The step that failed was ` +
      `${JSON.stringify(brokenStep.predicate)} and nothing matched it.\n\n` +
      `What is on screen now:\n${seen}\n\n` +
      `Give the single replacement step. Same id: ${brokenStep.id}.`,
  );
  const out = extractJson(reply);
  const steps = out.steps ?? [out];
  return toPlan(steps).steps[0];
};

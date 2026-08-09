#!/usr/bin/env node
// Throwaway. The measurement the whole product rests on.
//
// The claim: the second run is cheaper, and after the interface changes the
// cost comes back down. A second run that is merely cheaper only proves nothing
// broke. The interesting number is the RECOVERY CURVE — how many runs until
// cost returns to baseline. A flat curve proves nothing; a curve that recovers
// in one run proves adaptation.
//
// Two refusals are built in, because a measurement that flatters itself is
// worse than none:
//
//   - a run that did not complete produces NO table. A partial improvement
//     table would be quoted later as though it were established.
//   - a token delta measured with no model in the loop is a fabricated zero.
//     The harness refuses to report one.
//
// Usage:
//   node spikes/exec/measure.mjs --runs cold,warm,mutated,recovery
//   node spikes/exec/measure.mjs --runs cold --simulate-failure   (expect non-zero)
//   node spikes/exec/measure.mjs --runs warm --no-model           (expect non-zero)

import { writeFileSync } from 'node:fs';
import { interpret } from './interpret.mjs';
import { openScene, countingSurface } from './scene.mjs';
import { makeModel } from './model.mjs';
import { planCold, replanAfterDrift } from './agent.mjs';
import { recordWorkflow, replay } from './replay.mjs';
import { makeMemory, MustAsk } from './memory.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const val = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};

const RUNS = String(val('runs', 'cold,warm,mutated,recovery')).split(',');
const REPS = Number(val('reps', '3'));
const NO_MODEL = has('no-model');
const SIMULATE_FAILURE = has('simulate-failure');
const TASK = 'read the subject of my most recent email';
const ARTIFACT = val('out', 'docs/proofs/does-the-second-run-cost-less.md');

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const spread = (xs) => Math.max(...xs) - Math.min(...xs);
const fmt = (xs) =>
  xs.length === 0 ? 'n/a' : `${mean(xs).toFixed(1)} (${Math.min(...xs)}–${Math.max(...xs)})`;

// ---------------------------------------------------------------------------

const results = { cold: [], warm: [], mutated: [], recovery: [] };
let storedWorkflow = null;
let modelEverRan = false;
const rungLog = [];
const repairLog = [];
let failure = null;

const timed = async (fn) => {
  const t0 = Date.now();
  const out = await fn();
  return { ...out, ms: Date.now() - t0 };
};

async function runCold(model) {
  const scene = await openScene({ port: 9541 });
  try {
    const surface = countingSurface(scene.surface);
    const plan = await planCold({ model, surface, task: TASK });
    const out = await interpret(plan, surface);

    const resolved = new Map();
    for (const s of plan.steps) {
      const hits = await scene.surface.query(s.predicate?.within ? { role: s.predicate.role } : s.predicate ?? {});
      if (hits.length === 1) resolved.set(s.id, hits[0]);
    }
    storedWorkflow = recordWorkflow(plan, resolved);

    const read = out.log.find((l) => l.verb === 'read' || l.step?.includes('read'));
    return { steps: surface.steps, answered: read?.value ?? null, ok: true };
  } finally {
    await scene.close();
  }
}

async function runStored({ mutate = false, severe = false, model = null }) {
  if (!storedWorkflow) {
    // There is nothing to be warm ABOUT. Saying so plainly beats a TypeError
    // that looks like a bug in the harness rather than a misuse of it.
    throw new Error('no stored workflow — a warm run requires a cold run first');
  }
  const scene = await openScene({ port: 9542 });
  try {
    if (mutate) await (severe ? scene.mutateSevere() : scene.mutate());
    const surface = countingSurface(scene.surface);
    const r = await replay(storedWorkflow, surface);
    rungLog.push(r.rungs);
    if (r.repaired.length) repairLog.push(...r.repaired);

    let plan = r.plan;
    if (r.unresolved.length > 0) {
      // The stored workflow could not be resolved at any rung. THIS is where a
      // model is needed again, and it is exactly the cost the recovery curve
      // is measuring.
      if (!model) throw new Error('stored workflow unresolved and no model available to re-plan');
      const fixed = await replanAfterDrift({
        model,
        surface,
        task: TASK,
        brokenStep: r.unresolved[0],
      });
      plan = {
        ...plan,
        steps: plan.steps.map((s) => (s.id === fixed.id ? { ...s, predicate: fixed.predicate } : s)),
      };
      // Write the repair back into the stored workflow so the NEXT run starts
      // from a working rung-1 locator. Without this the curve never recovers.
      storedWorkflow = {
        ...storedWorkflow,
        steps: storedWorkflow.steps.map((s) =>
          s.id === fixed.id
            ? {
                ...s,
                predicate: fixed.predicate,
                locators: s.locators
                  ? s.locators.map((l) =>
                      l.rung === 'meaning' ? { rung: 'meaning', predicate: fixed.predicate } : l,
                    )
                  : null,
              }
            : s,
        ),
      };
      repairLog.push(`${fixed.id} (re-planned)`);
    }

    const out = await interpret(plan, surface);
    const read = out.log.find((l) => l.step?.includes('read'));
    return { steps: surface.steps, answered: read?.value ?? null, ok: true };
  } finally {
    await scene.close();
  }
}

// --- the memory half, measured separately -----------------------------------
// Deterministic on purpose. Memory's contribution is a question asked or not
// asked, and mixing model sampling noise into it would make the one clear
// column in this table as noisy as the others.
async function measureMemory() {
  const people = (names) => ({
    async query(pred) {
      return names
        .map((n, i) => ({ key: `p${i}`, role: 'button', name: n, ancestry: [] }))
        .filter((n) => (pred.name ? n.name === pred.name : true));
    },
  });
  const predicateFor = (name) => ({ role: 'button', name });
  const out = {};

  // 1. remembered, and still unique
  {
    const m = makeMemory({ sister: 'Jessica Baily' });
    const r = await m.resolve('sister', people(['Jessica Baily', 'Jessica Hester']), predicateFor);
    out.withMemory = { asked: r.asked, value: r.value };
  }
  // 2. memory cleared — must ask
  {
    const m = makeMemory({});
    try {
      await m.resolve('sister', people(['Jessica Baily', 'Jessica Hester']), predicateFor);
      out.withoutMemory = { asked: false };
    } catch (e) {
      out.withoutMemory = { asked: e instanceof MustAsk, why: e.reason };
    }
  }
  // 3. the world changed: a SECOND Jessica Baily. The remembered answer is
  //    still there and is no longer unique — the worst failure available to
  //    this design if it is reused.
  {
    const m = makeMemory({ sister: 'Jessica Baily' });
    try {
      const r = await m.resolve(
        'sister',
        people(['Jessica Baily', 'Jessica Baily', 'Jessica Hester']),
        predicateFor,
      );
      out.invalidated = { asked: false, reused: r.value };
    } catch (e) {
      out.invalidated = {
        asked: e instanceof MustAsk,
        why: e.reason,
        candidates: e.candidates.length,
      };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

const model = makeModel({ disabled: NO_MODEL });
let memoryResults = null;

try {
  for (let rep = 0; rep < REPS; rep++) {
    if (RUNS.includes('cold')) {
      const r = await timed(() => runCold(model));
      results.cold.push({ ...r, tokens: model.usage.totalTokens });
    }
    const tokensAfterCold = model.usage.totalTokens;

    if (RUNS.includes('warm')) {
      const r = await timed(() => runStored({ model }));
      results.warm.push({ ...r, tokens: model.usage.totalTokens - tokensAfterCold });
    }
    const tokensAfterWarm = model.usage.totalTokens;

    if (RUNS.includes('mutated')) {
      // Severe on purpose. A rename alone is absorbed by the ladder at zero
      // token cost — which is a real and good result, but it leaves the
      // re-planning path never executed and a recovery curve with no spike to
      // recover from. The severe mutation makes rung 2 ambiguous, and an
      // ambiguous rung is refused rather than guessed, so the model is needed.
      const r = await timed(() => runStored({ mutate: true, severe: true, model }));
      results.mutated.push({ ...r, tokens: model.usage.totalTokens - tokensAfterWarm });
    }
    const tokensAfterMutated = model.usage.totalTokens;

    if (RUNS.includes('recovery')) {
      // The run AFTER the mutation, with the change still in place. If the
      // repair was written back, this costs what a warm run costs.
      const r = await timed(() => runStored({ mutate: true, severe: true, model }));
      results.recovery.push({ ...r, tokens: model.usage.totalTokens - tokensAfterMutated });
    }

    if (SIMULATE_FAILURE && rep === 0) {
      failure = 'simulated: a run was told to fail';
      break;
    }
    // Each repetition starts from a clean slate, or repetition 2 would begin
    // with repetition 1's repairs already applied and would not be a repetition.
    if (rep < REPS - 1) storedWorkflow = null;
  }

  if (RUNS.includes('warm') || RUNS.includes('cold')) memoryResults = await measureMemory();
} catch (e) {
  failure = `${e.name}: ${e.message}`;
} finally {
  // Read from the model itself, and OUTSIDE the try. Setting this at the end of
  // the happy path meant any failure reported "no model call occurred" on top
  // of the real error — a false second reason that would send the next reader
  // hunting for a missing API key instead of the actual fault.
  modelEverRan = model.ran;
}

// --- refusals ---------------------------------------------------------------

const problems = [];
if (failure) problems.push(`a run did not complete — ${failure}`);

for (const name of RUNS) {
  if (results[name] && results[name].length === 0) problems.push(`no data for run "${name}"`);
  if (results[name]?.some((r) => !r.ok)) problems.push(`run "${name}" reported failure`);
}

// The anti-vacuity check. A harness that reports a token delta while no model
// ran is measuring nothing at all, and it would report a flattering zero.
if (!modelEverRan) {
  problems.push(
    'no model call occurred in this measurement — a token delta with no model in the loop is a fabricated zero',
  );
}

if (problems.length > 0) {
  console.error('REFUSING TO WRITE A TABLE:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nA partial improvement table is worse than none, because it gets quoted later.');
  process.exit(1);
}

// --- the table --------------------------------------------------------------

const col = (name, field) => results[name].map((r) => r[field]);
const row = (name) =>
  `| ${name} | ${fmt(col(name, 'steps'))} | ${fmt(col(name, 'tokens'))} | ${fmt(col(name, 'ms'))} |`;

const coldSteps = col('cold', 'steps');
const warmSteps = col('warm', 'steps');
const stepsDiff = mean(coldSteps) - mean(warmSteps);
const noisier = spread(coldSteps) > Math.abs(stepsDiff);

const coldTok = col('cold', 'tokens');
const warmTok = col('warm', 'tokens');
const recTok = col('recovery', 'tokens');
const mutTok = col('mutated', 'tokens');

// Each column is judged against its OWN noise. Steps is the pass/fail measure;
// tokens and wall-clock are reported deltas. Letting a clean steps column carry
// a noisy token column would be the exact move this milestone exists to avoid.
const tokenSpread = spread(coldTok);
const tokenDiff = mean(coldTok) - mean(warmTok);
const tokensNoisy = tokenSpread > Math.abs(tokenDiff);

const verdict = noisier
  ? 'UNMEASURABLE AT THIS SAMPLE SIZE — the spread between repetitions is larger than the difference between cold and warm.'
  : mean(warmTok) < mean(coldTok) && mean(recTok) <= mean(warmTok) + Math.max(1, mean(mutTok) * 0.25)
    ? 'SUPPORTED — the second run is cheaper, and cost returns to baseline one run after the interface changed.'
    : 'NOT SUPPORTED — the saving did not appear, or cost did not return to baseline.';

const doc = `# Does the second run cost less

Produced by \`spikes/exec/measure.mjs\`, which is deleted at the end of M0.5.
${REPS} repetitions per run. Every cell is **mean (min–max)**.

The task is given in plain language — "${TASK}" — and an agent must author the
plan. The interpreter that executes it contains no model, in either run. So what
is being measured is a **planning** saving, not a faster click.

| run | steps | tokens | wall-clock (ms) |
|---|---|---|---|
${row('cold')}
${row('warm')}
${row('mutated')}
${row('recovery')}

- **cold** — no stored workflow. The agent looks, causes the list to appear, and
  has to look again, because content that does not exist yet cannot be planned
  against. That second look is the expensive part.
- **warm** — the stored workflow's predicates are re-resolved. No model is
  consulted, so the token count is not the model being cheaper; it is the model
  being **absent**. That distinction matters and is easy to overstate.
- **mutated** — the entry point was renamed, so the stored rung-1 locator
  (role plus name) no longer matches.
- **recovery** — run again with the rename still in place.

## Verdict

**${verdict}**

Steps: cold ${fmt(coldSteps)} versus warm ${fmt(warmSteps)}, a difference of
${stepsDiff.toFixed(1)} against a between-repetition spread of ${spread(coldSteps)}.
${
  noisier
    ? 'The honest conclusion is that the effect was not measurable here — not that it is absent.'
    : 'The difference is larger than the noise, so the comparison carries.'
}

**The token column is noisier than the steps column, and it must not borrow the
steps column's confidence.** Cold tokens spread ${tokenSpread} across ${REPS}
repetitions against a cold-to-warm difference of ${tokenDiff.toFixed(0)}${
  tokensNoisy
    ? ' — the spread is LARGER than the difference, so the token saving is not established at this sample size, however large the mean looks'
    : ' — the difference clears the spread'
}. The model's reply length varies run to run even at temperature zero; steps do
not. This is why steps-to-completion is the pass/fail measure and tokens are a
reported delta rather than a claim.

## Which rung matched, and what was repaired

${rungLog
  .map(
    (r, i) =>
      `- run ${i + 1}: ${r.map((x) => `${x.step}=${x.rung ?? '**no rung matched**'}`).join(', ')}`,
  )
  .join('\n')}

Repairs written back: ${repairLog.length > 0 ? `\`${[...new Set(repairLog)].join('`, `')}\`` : 'none'}

The write-back is the part that makes the curve recover rather than flatten. A
run that finds its target at a lower rung and does **not** re-derive the rung-1
locator pays the same penalty forever, and the second run after a change looks
exactly like the first.

## The two learning substrates, kept apart

A stored workflow and a memory both make the second run cheaper, and a single
number cannot say which one is working. They are measured separately, and the
memory half is measured deterministically so that model sampling noise does not
leak into the one column that is unambiguous.

| condition | asked the user? | outcome |
|---|---|---|
| remembered, still unique | ${memoryResults.withMemory.asked ? 'yes' : '**no**'} | reused \`${memoryResults.withMemory.value}\` |
| memory cleared | ${memoryResults.withoutMemory.asked ? '**yes**' : 'no'} | ${memoryResults.withoutMemory.why ?? ''} |
| a second person with the same name appears | ${memoryResults.invalidated.asked ? '**yes**' : 'no'} | ${memoryResults.invalidated.why ?? `reused ${memoryResults.invalidated.reused}`} |

The third row is the one that matters. A stored locator goes stale when the
interface changes: it fails by not finding something, which is loud. A
remembered answer goes stale when the **world** changes, and it fails by finding
the *wrong* something, which is silent. Reusing a remembered answer that now
matches two people would be the worst failure available to this design — it is
confidently wrong and leaves no trace of having guessed.

So the rule already adopted for locators applies to memory as well: when a
remembered answer no longer resolves uniquely, **re-ask**. Never reuse it, and
never quietly prefer the newer one.

## G2 — does the wait fire for content that did not exist before the click?

**Yes, and it is load-bearing rather than incidental.** Every run in the table
above contains a step that clicks an entry point and then waits for a message
list that does not exist in any tree until that click happens. If the wait
failed, the step would throw, the run would not complete, and this harness would
refuse to write a table at all. The table exists, so the materialisation wait
fired on all ${
  results.cold.length + results.warm.length + results.mutated.length + results.recovery.length
} runs.

That is a polling wait. The push version was measured separately in
[can we subscribe to element changes](can-we-subscribe-to-element-changes.md):
a change subscription installed before page script, surviving navigation, which
observed content materialise 253ms after the click that caused it. Polling is
what this interpreter uses; push is what the daemon should offer, because a
poll cannot tell you that nothing is going to happen.

## Receipt

\`\`\`
node spikes/exec/measure.mjs --runs cold,warm,mutated,recovery --reps ${REPS}
node spikes/exec/measure.mjs --runs cold --simulate-failure   # refuses: partial table
node spikes/exec/measure.mjs --runs warm --no-model           # refuses: fabricated zero
\`\`\`

Model in the planning path: \`deepseek-chat\`, ${model.usage.calls} calls,
${model.usage.totalTokens} tokens total across the whole measurement.
`;

writeFileSync(ARTIFACT, doc);
console.log(doc.split('\n## Which rung')[0]);
console.log(`\nWrote ${ARTIFACT}`);

// Throwaway. Each test asserts one property the phase claims, and each one is
// written so that it FAILS if the property is removed. A rule with no failing
// test is a wish.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpret, Ambiguous, Suspended } from './interpret.mjs';
import { fixtureSurface } from './surface.mjs';
import { scenario, ambiguousScenario, step } from './plan.mjs';
import { mergeBatches } from './agent.mjs';

// A fixture with the shape of a mail interface: the message list does not exist
// until the inbox link is clicked, which is the materialisation case.
const mailFixture = () => [
  {
    key: 'root',
    role: 'main',
    name: 'Mail',
    children: [
      {
        key: 'inbox-link',
        role: 'link',
        name: 'Inbox',
        revealInto: 'root',
        reveals: [
          {
            key: 'list',
            role: 'list',
            name: 'Messages',
            children: [
              {
                key: 'msg-1',
                role: 'listitem',
                name: 'msg-1',
                children: [{ key: 'subj-1', role: 'heading', name: 'The newest subject' }],
              },
              {
                key: 'msg-2',
                role: 'listitem',
                name: 'msg-2',
                children: [{ key: 'subj-2', role: 'heading', name: 'An older subject' }],
              },
            ],
          },
        ],
      },
    ],
  },
];

test('the plan representation refuses prose as a precondition', () => {
  assert.throws(
    () => step({ id: 'x', verb: 'click', class: 'reveal', predicate: 'the compose button' }),
    /note to a model/,
    'a sentence must not be accepted as a predicate',
  );
});

test('a live run reads the subject through materialised content', async () => {
  const surface = fixtureSurface(mailFixture());
  const out = await interpret(scenario(), surface);
  const read = out.log.find((l) => l.step === 'read-subject');
  assert.equal(read.outcome, 'ok');
  assert.equal(read.value, 'The newest subject');
});

test('a dry run emits the full intended-effect list and causes nothing', async () => {
  const surface = fixtureSurface(mailFixture());
  const before = await surface.snapshot();
  const dry = await interpret(scenario(), surface, { dryRun: true });
  const after = await surface.snapshot();

  assert.ok(dry.intendedEffects.length > 0, 'a dry run must still declare intent');
  assert.deepEqual(
    after,
    before,
    'a dry run that changed the world is not a dry run',
  );
});

test('a dry run reports where it stopped instead of pretending it finished', async () => {
  // The honest limit of record-and-refuse: a refused click cannot reveal what
  // the click would have revealed, so steps beyond a materialising effect are
  // unreachable. The interpreter must SAY so — silently returning a short
  // effect list would understate what the plan actually requires, and that
  // list is what a manifest is built from.
  const dry = await interpret(scenario(), fixtureSurface(mailFixture()), { dryRun: true });
  assert.equal(dry.truncatedAt, 'locate-list');
  assert.ok(
    dry.log.some((l) => String(l.outcome).startsWith('unreachable')),
    'the truncation must appear in the log, not only in a field',
  );
});

test('the dry run agrees with the live run up to the first effect', async () => {
  const dry = await interpret(scenario(), fixtureSurface(mailFixture()), { dryRun: true });
  const live = await interpret(scenario(), fixtureSurface(mailFixture()));

  // Beyond the first effect the two legitimately diverge: a refused click never
  // reveals what the click would have revealed. Agreement is asserted only up
  // to that point, and divergence past it is expected rather than a failure.
  const firstDry = dry.intendedEffects[0];
  const firstLive = live.intendedEffects[0];
  assert.deepEqual(
    { step: firstDry.step, effect: firstDry.effect },
    { step: firstLive.step, effect: firstLive.effect },
  );
});

test('the permission manifest is derived by running, never written down', async () => {
  const plan = scenario();
  assert.equal(plan.metadata.derivedManifest, null, 'the authored plan must not carry a manifest');

  const dry = await interpret(plan, fixtureSurface(mailFixture()), { dryRun: true });
  assert.ok(dry.manifest.scopes.length > 0, 'the dry run must produce scopes');
  assert.deepEqual(dry.manifest.scopes, ['reveal']);

  // The manifest a dry run derives is a LOWER BOUND, not the whole answer,
  // because the run stopped where the effects stopped. Asserting equality with
  // the live run would be asserting a falsehood; the real property is that the
  // dry run never claims a scope the live run did not need.
  const live = await interpret(scenario(), fixtureSurface(mailFixture()));
  for (const scope of dry.manifest.scopes) {
    assert.ok(
      live.manifest.scopes.includes(scope),
      `dry run claimed scope ${scope} that the live run never needed`,
    );
  }
  assert.ok(dry.truncatedAt, 'a truncated dry run must admit it was truncated');
});

test('an ambiguous predicate returns every candidate and never picks one', async () => {
  const surface = fixtureSurface([
    {
      key: 'root',
      role: 'main',
      name: 'Chat',
      children: [
        {
          key: 'a',
          role: 'button',
          name: 'Jessica Baily',
          children: [],
        },
        {
          key: 'b',
          role: 'button',
          name: 'Jessica Hester',
          children: [],
        },
      ],
    },
  ]);

  await assert.rejects(
    () => interpret(ambiguousScenario(), surface),
    (err) => {
      assert.ok(err instanceof Ambiguous, 'must raise Ambiguous, not proceed');
      assert.equal(err.candidates.length, 2);
      const names = err.candidates.map((c) => c.name).sort();
      assert.deepEqual(names, ['Jessica Baily', 'Jessica Hester']);
      // Enough context to phrase a natural question without another round trip.
      assert.ok(err.candidates.every((c) => Array.isArray(c.ancestry)));
      return true;
    },
  );
});

test('an ambiguous run causes no effect at all', async () => {
  const surface = fixtureSurface([
    {
      key: 'root',
      role: 'main',
      name: 'Chat',
      children: [
        { key: 'a', role: 'button', name: 'Jessica Baily', children: [] },
        { key: 'b', role: 'button', name: 'Jessica Hester', children: [] },
      ],
    },
  ]);
  const before = await surface.snapshot();
  await interpret(ambiguousScenario(), surface).catch(() => {});
  assert.deepEqual(await surface.snapshot(), before, 'refusing must not transmit');
});

test('a run suspends at the moment of uncertainty and resumes on an answer', async () => {
  const plan = {
    id: 'ask-then-act',
    metadata: { derivedManifest: null },
    steps: [
      step({ id: 'find-field', verb: 'resolve', class: 'observe', predicate: { role: 'textbox', name: 'Message' } }),
      step({
        id: 'type-message',
        verb: 'type',
        class: 'edit',
        predicate: { role: 'textbox', name: 'Message' },
        effects: ['message-drafted'],
        needs: 'message-text',
        question: 'What should the message say?',
      }),
    ],
  };
  const fixture = () => [
    { key: 'root', role: 'main', name: 'Chat', children: [{ key: 'f', role: 'textbox', name: 'Message', value: '' }] },
  ];

  const surface = fixtureSurface(fixture());
  let suspension = null;
  await interpret(plan, surface).catch((e) => {
    suspension = e;
  });

  assert.ok(suspension instanceof Suspended, 'must suspend rather than guess');
  assert.equal(suspension.question, 'What should the message say?');
  assert.ok(suspension.state.resolved.length > 0, 'resolved state must survive the pause');

  // Resume: the completed step must not be resolved again.
  const resumed = await interpret(plan, surface, {
    answers: { 'message-text': 'hello' },
    resumeFrom: suspension.state,
  });
  assert.equal(resumed.log.find((l) => l.step === 'type-message').outcome, 'ok');
  assert.deepEqual(resumed.rederived, [], 'a resumed run must not re-derive what it already had');
});

test('effects are taken from what the surface did, not from what the plan claimed', async () => {
  const surface = fixtureSurface(mailFixture());
  const out = await interpret(scenario(), surface);
  // The plan CLAIMS 'message-list-visible'. The observation is independent: the
  // list genuinely appeared in the tree.
  assert.ok(out.intendedEffects.some((e) => e.effect === 'message-list-visible'));
  assert.ok(
    out.observedEffects.some((e) => e.change === 'appeared' && e.name === 'Messages'),
    'the observed list must come from the surface diff, not the plan',
  );
});

test('a predicate matching nothing fails loudly rather than skipping', async () => {
  const plan = {
    id: 'missing',
    metadata: {},
    steps: [step({ id: 'nope', verb: 'read', class: 'observe', predicate: { role: 'link', name: 'Nowhere' } })],
  };
  await assert.rejects(() => interpret(plan, fixtureSurface(mailFixture())), /matched nothing/);
});

test('two planning batches never produce colliding step ids', () => {
  // Both model calls number their steps from one. A collision is not cosmetic:
  // steps are addressed by id, `within` resolves by id, and the recorded
  // workflow keys elements by id — so one step's resolution would quietly
  // stand in for another's. This was found in rung telemetry, not in the table.
  const merged = mergeBatches(
    [{ id: '1', verb: 'click', class: 'reveal', predicate: { role: 'link', name: 'Inbox' } }],
    [
      { id: '1', verb: 'resolve', class: 'observe', predicate: { role: 'list', name: 'Messages' } },
      { id: '2', verb: 'read', class: 'observe', predicate: { role: 'heading', within: '1' } },
    ],
  );

  const ids = merged.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'step ids must be unique');

  // The scope must follow the renamed step, not reattach to the first batch's
  // step of the same name.
  const reader = merged.find((s) => s.verb === 'read');
  const listStep = merged.find((s) => s.predicate?.role === 'list');
  assert.equal(reader.predicate.within, listStep.id);
  assert.notEqual(reader.predicate.within, '1');
});

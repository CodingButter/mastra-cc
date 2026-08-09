// Throwaway. The plan representation.
//
// A plan is data. It says what to do in terms a program can execute without
// asking anyone anything. The rule this file exists to enforce:
//
//   A precondition that cannot be expressed as a resolvable predicate is not
//   captured — it is a note to a language model, and the workflow learned
//   nothing.
//
// So every step's target is a PREDICATE (role, name, states), never an
// identifier, and every locator carries its durability rung. Identifiers are
// dead on restart and are only ever tiebreakers.

// Durability rungs, most durable first. A locator that matches at a lower rung
// than last time is drift: the thing still exists and its address changed.
export const RUNGS = ['meaning', 'relation', 'position', 'literal'];

// Operation classes. The honest axis is what an action DOES, not whether it is
// a click: revealing rearranges what is visible and transmits nothing;
// transmitting leaves the machine and cannot be taken back.
export const CLASSES = ['observe', 'reveal', 'edit', 'transmit'];

/**
 * A plan step.
 * @param {object} spec
 * @param {string} spec.id
 * @param {string} spec.verb          one of: resolve, read, click, type, scroll, waitFor
 * @param {object} [spec.predicate]   {role, name, nameContains, states, within}
 * @param {string} spec.class         one of CLASSES
 * @param {string[]} [spec.effects]   what this step is expected to change
 * @param {object} [spec.awaits]      {appears: predicate} — materialisation
 * @param {string} [spec.literalHint] last known identifier; TIEBREAKER ONLY
 */
export const step = (spec) => {
  if (!CLASSES.includes(spec.class)) {
    throw new Error(`step ${spec.id}: unknown class ${spec.class}`);
  }
  if (spec.predicate && typeof spec.predicate === 'string') {
    throw new Error(
      `step ${spec.id}: predicate is a string. A sentence is a note to a model, not a predicate.`,
    );
  }
  return { effects: [], ...spec };
};

/**
 * The Gmail-shaped scenario, expressed against a fixture with the same
 * structure: open the message list, find the most recent message, read its
 * subject. Every precondition below is a predicate a daemon can answer yes or
 * no to. None of them is prose.
 */
export const scenario = () => ({
  id: 'read-most-recent-subject',
  metadata: {
    // The permission manifest rides here and is DERIVED by a dry run, never
    // hand-written. It is left empty on purpose: a manifest written by the
    // author is a claim, and a manifest produced by execution is a record.
    derivedManifest: null,
  },
  steps: [
    step({
      id: 'open-inbox',
      verb: 'click',
      class: 'reveal',
      predicate: { role: 'link', name: 'Inbox' },
      effects: ['message-list-visible'],
      awaits: { appears: { role: 'list', name: 'Messages' } },
    }),
    step({
      id: 'locate-list',
      verb: 'resolve',
      class: 'observe',
      predicate: { role: 'list', name: 'Messages' },
    }),
    step({
      id: 'locate-newest',
      verb: 'resolve',
      class: 'observe',
      // "within" is the relation rung: survives reflow, unlike position.
      predicate: { role: 'listitem', within: 'locate-list', position: 'first' },
    }),
    step({
      id: 'read-subject',
      verb: 'read',
      class: 'observe',
      predicate: { role: 'heading', within: 'locate-newest' },
    }),
  ],
});

/**
 * The ambiguous variant: a predicate that matches two elements. Used to prove
 * the interpreter refuses rather than taking the first.
 */
export const ambiguousScenario = () => ({
  id: 'ambiguous-recipient',
  metadata: { derivedManifest: null },
  steps: [
    step({
      id: 'pick-jessica',
      verb: 'click',
      class: 'transmit',
      predicate: { role: 'button', nameContains: 'Jessica' },
      effects: ['message-sent'],
    }),
  ],
});

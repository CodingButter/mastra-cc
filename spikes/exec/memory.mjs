// Throwaway. The OTHER thing that makes a second run cheaper, and the one that
// can be confidently wrong.
//
// A stored workflow learns HOW to do the thing: predicates, plan shape, waits.
// Memory learns WHO AND WHAT the user means: that "my sister" is Jessica Baily
// rather than Jessica Hester. Both reduce the cost of the second run, and a
// measurement that adds them together cannot say which one is working.
//
// They also go stale differently, and that difference is the whole reason this
// file is separate:
//
//   a stored locator goes stale when the INTERFACE changes. The target still
//   exists, the address moved, and re-resolving at a lower rung finds it. It
//   fails by not finding something.
//
//   a remembered answer goes stale when the WORLD changes. "Sister means
//   Jessica Baily" is correct right up until a second Jessica Baily appears,
//   at which point it is not out of date — it is silently wrong. It fails by
//   finding the wrong something, which leaves no trace of having guessed.
//
// So the rule already adopted for locators is applied here to a different
// substrate: when a remembered answer no longer resolves uniquely, that is a
// re-ask, not a reuse.

export class MustAsk extends Error {
  constructor(key, reason, candidates = []) {
    super(`re-ask ${key}: ${reason}`);
    this.name = 'MustAsk';
    this.key = key;
    this.reason = reason;
    this.candidates = candidates;
  }
}

export const makeMemory = (initial = {}) => {
  const store = new Map(Object.entries(initial));
  const events = [];

  return {
    events,
    get size() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    remember(key, value) {
      store.set(key, value);
      events.push({ kind: 'remembered', key, value });
    },

    /**
     * Resolve what the user meant, against the world as it is now.
     *
     * @param {string} key        e.g. "sister"
     * @param {object} surface    where the answer has to still be true
     * @param {object} predicate  how to look for the remembered answer
     * @throws {MustAsk} when nothing is remembered, or when the remembered
     *                   answer no longer picks out exactly one thing.
     */
    async resolve(key, surface, predicateFor) {
      if (!store.has(key)) {
        events.push({ kind: 'asked', key, why: 'nothing remembered' });
        throw new MustAsk(key, 'nothing remembered');
      }
      const remembered = store.get(key);
      const hits = await surface.query(predicateFor(remembered));

      if (hits.length === 1) {
        events.push({ kind: 'reused', key, value: remembered });
        return { value: remembered, element: hits[0], asked: false };
      }

      // The dangerous case, and the reason this is not a plain cache. The
      // answer is still THERE — it just is not unique any more, so acting on it
      // would be picking one of two people with the same name and never
      // mentioning it.
      const why =
        hits.length === 0
          ? 'the remembered answer is no longer present'
          : `the remembered answer now matches ${hits.length} things`;
      events.push({ kind: 'asked', key, why });
      throw new MustAsk(key, why, hits.map((h) => ({ role: h.role, name: h.name })));
    },
  };
};

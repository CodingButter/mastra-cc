import { describe, expect, it } from "vitest";
import { createCollapseBackstop } from "../signal-stream.js";

// The ambient-noise backstop, and what it is allowed to remember.
//
// Its whole job is one comparison - was this element's last change less than a
// window ago - so an entry older than the window can never change an answer
// again. The map that held those entries was never evicted, which made a watch
// over a busy subtree pay for every element id it had EVER seen (#52). These
// tests pin both halves: the collapse decision is exactly what it was, and
// retention is bounded by the window rather than by the id count.
//
// Time is passed in, never read, so none of this depends on a clock or on fake
// timers. Retention is asserted on size() and NEVER on the heap - a heap
// assertion is a GC-timing coin flip and would be flaky in CI.

const WINDOW = 100;

describe("the change-collapse backstop", () => {
  it("collapses a repeat on the same element inside the window", () => {
    const backstop = createCollapseBackstop(WINDOW);
    expect(backstop.collapses("el-aaaaaaaaaaaa", 1000)).toBe(false);
    expect(backstop.collapses("el-aaaaaaaaaaaa", 1050)).toBe(true);
  });

  it("lets the same element through once the window has passed", () => {
    const backstop = createCollapseBackstop(WINDOW);
    expect(backstop.collapses("el-aaaaaaaaaaaa", 1000)).toBe(false);
    expect(backstop.collapses("el-aaaaaaaaaaaa", 1100)).toBe(false);
  });

  it("keeps collapsing a sustained sub-window stream instead of leaking one change per window", () => {
    // The repeat that gets collapsed still refreshes the stamp - the write
    // precedes the verdict. A typist holding a key must not produce a change
    // every 100ms just because the window rolled over.
    const backstop = createCollapseBackstop(WINDOW);
    expect(backstop.collapses("el-aaaaaaaaaaaa", 1000)).toBe(false);
    for (let beat = 1; beat <= 200; beat += 1) {
      expect(backstop.collapses("el-aaaaaaaaaaaa", 1000 + beat * 10)).toBe(true);
    }
  });

  it("decides each element on its own history: one busy element never silences another", () => {
    const backstop = createCollapseBackstop(WINDOW);
    expect(backstop.collapses("el-aaaaaaaaaaaa", 1000)).toBe(false);
    expect(backstop.collapses("el-bbbbbbbbbbbb", 1001)).toBe(false);
    expect(backstop.collapses("el-cccccccccccc", 1002)).toBe(false);
    expect(backstop.collapses("el-aaaaaaaaaaaa", 1003)).toBe(true);
    expect(backstop.collapses("el-bbbbbbbbbbbb", 1004)).toBe(true);
  });

  it("still collapses an element whose last change was in the window just gone", () => {
    // The case the demoted map exists for. `el-a` is stamped at 1099, the
    // window rotates at 1150, and the repeat 51ms after the stamp must still
    // collapse - it can only be found by looking past the fresh map into the
    // one just retired.
    const backstop = createCollapseBackstop(WINDOW);
    expect(backstop.collapses("el-opens-the-window", 1000)).toBe(false);
    expect(backstop.collapses("el-aaaaaaaaaaaa", 1099)).toBe(false);
    expect(backstop.collapses("el-aaaaaaaaaaaa", 1150)).toBe(true);
  });

  it("holds only the ids of the last two windows, not every id it has ever seen", () => {
    // The acceptance criterion. 200,000 distinct elements go through, which is
    // the shape a long-lived watch over a document that appears and disappears
    // nodes produces. What is retained is what the window can still decide
    // with - a handful - not the 200,000.
    const backstop = createCollapseBackstop(WINDOW);
    let now = 1000;
    for (let element = 0; element < 200_000; element += 1) {
      backstop.collapses(`el-${element}`, now);
      now += 1;
    }
    expect(backstop.size()).toBeLessThanOrEqual(2 * WINDOW);
    // And the entries kept are the recent ones: the oldest id is long gone, so
    // it reads as new rather than as a collapse.
    expect(backstop.collapses("el-0", now)).toBe(false);
  });

  it("drops everything it was holding after two idle windows", () => {
    // A stream that goes quiet must not park a full window's ids in the
    // demoted map for as long as the silence lasts.
    const backstop = createCollapseBackstop(WINDOW);
    for (let element = 0; element < 1000; element += 1) {
      backstop.collapses(`el-${element}`, 1000);
    }
    expect(backstop.size()).toBe(1000);
    expect(backstop.collapses("el-late", 5000)).toBe(false);
    expect(backstop.size()).toBe(1);
  });

  it("agrees with an unevicted map on every answer, over a mixed stream", () => {
    // The fix is a memory bound, not a behaviour change, so the verdict is
    // differential-tested against the naive map the module used to keep.
    const backstop = createCollapseBackstop(WINDOW);
    const naive = new Map<string, number>();
    const naiveCollapses = (id: string, now: number) => {
      const last = naive.get(id);
      naive.set(id, now);
      return last !== undefined && now - last < WINDOW;
    };

    // A deterministic pseudo-random walk: a small set of hot ids the windows
    // straddle, a long tail of ids seen once, and gaps of every size around
    // the window boundary.
    let seed = 20260828;
    const next = (bound: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % bound;
    };
    let now = 0;
    for (let step = 0; step < 20_000; step += 1) {
      now += next(260);
      const id = next(3) === 0 ? `el-hot-${next(4)}` : `el-cold-${step}`;
      expect(backstop.collapses(id, now)).toBe(naiveCollapses(id, now));
    }
    // Same answers throughout, a fraction of the retention.
    expect(naive.size).toBeGreaterThan(10_000);
    expect(backstop.size()).toBeLessThanOrEqual(2 * WINDOW);
  });
});

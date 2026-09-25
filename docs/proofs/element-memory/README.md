# Element memory is bounded (ADR-0116)

`sizing.test.ts` answers 500 queries from a synthetic browser page whose 100 nodes are new every time. That is 50,000 distinct element ids. It prints how many ids the backend still holds and how much the heap grew (after `--expose-gc`).

| | ids held | heap growth |
|---|---|---|
| `master` ([without.txt](without.txt)) | 50,001 (every id ever answered) | 18.7 MB |
| branch ([with.txt](with.txt)) | 10,000 (the cap) | 6.1 MB |

To reproduce, copy `sizing.test.ts` into `daemon/src/__tests__/` and run `NODE_OPTIONS=--expose-gc npx vitest run src/__tests__/sizing.test.ts` from `daemon/`. Heap figures are for a single run on one machine. Only the held count is the claim; heap figures vary.

Behavior tests: `daemon/src/__tests__/element-memory-is-bounded.test.ts`. It checks the cap, least-recently-used order, and that a forgotten id is refused as `UnknownElement` with its sibling facts gone, on both the ATSPI and the CDP backends.

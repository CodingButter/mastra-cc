// The elements a backend has answered, bounded (ADR-0116). Every id the daemon
// hands out is remembered so a later read, effect, watch or press can re-find
// the live element - but a long-lived daemon answers without end, so memory is
// capped and the least recently used id is forgotten first. A forgotten id is
// indistinguishable from one never answered: it takes the existing "query
// again" refusal, never a wrong element. `forget` lets the backend drop every
// sibling fact keyed by the same id, so the bound holds for all of them.
export const ELEMENT_MEMORY_CAP = 10_000;

export class ElementMemory<V> {
  private readonly entries = new Map<string, V>();

  constructor(
    private readonly cap: number,
    private readonly forget: (id: string, value: V) => void,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  // A use is a touch: the id moves to the most recently used end.
  get(id: string): V | undefined {
    const value = this.entries.get(id);
    if (value === undefined) return undefined;
    this.entries.delete(id);
    this.entries.set(id, value);
    return value;
  }

  set(id: string, value: V): void {
    this.entries.delete(id);
    this.entries.set(id, value);
    while (this.entries.size > this.cap) {
      const [oldest, dropped] = this.entries.entries().next().value as [string, V];
      this.entries.delete(oldest);
      this.forget(oldest, dropped);
    }
  }
}

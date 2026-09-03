export class DeskCache<T> {
  #current: T | undefined;

  constructor(private readonly create: () => T) {}

  get(): T {
    return (this.#current ??= this.create());
  }

  invalidate(instance: T): void {
    if (this.#current === instance) this.#current = undefined;
  }
}

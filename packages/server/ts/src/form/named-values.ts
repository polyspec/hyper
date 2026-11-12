// The names of a request part in the order of their first occurrence and the values of each name in request order,
// which Fields and Files hold (HY-56, HY-57, HY-113).
/** @internal */
export abstract class NamedValues<T> {
  private readonly order: readonly string[];
  private readonly byName: ReadonlyMap<string, readonly T[]>;

  constructor(names: readonly string[], values: ReadonlyMap<string, readonly T[]>) {
    this.order = names;
    this.byName = values;
  }

  // Returns the names in the order of their first occurrence.
  names(): string[] {
    return [...this.order];
  }

  // Returns the values of a name in request order; an absent name has none.
  get(name: string): T[] {
    return [...(this.byName.get(name) ?? [])];
  }

  // Returns the last value of a name, or null.
  last(name: string): T | null {
    return this.byName.get(name)?.at(-1) ?? null;
  }

  // Returns each name with its values, in the order of the names (HY-56.4).
  pairs(): [string, T[]][] {
    return this.order.map((name) => [name, this.get(name)]);
  }
}

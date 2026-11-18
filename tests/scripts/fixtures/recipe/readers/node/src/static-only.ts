/** A class of static methods, whose empty private constructor stops its construction. @internal */
export class StaticOnly {
  private constructor() {}

  static twice(n: number): number {
    return 2 * n;
  }
}

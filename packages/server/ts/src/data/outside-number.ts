// A number of a JSON text that has no value in the data model: a number outside ±(2^53 − 1) or one that is not finite
// (HY-38, HY-40, HY-54).

/** @internal */
export class OutsideNumber {
  readonly literal: string;

  constructor(literal: string) {
    this.literal = literal;
  }
}

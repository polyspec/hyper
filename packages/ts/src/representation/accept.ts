// The Accept field of a request: its ranges, which the core reads (HY-116.17, HY-116.18), and the selection of a
// media type by the weights of its ranges (HY-116).
import { rules } from '../app/core-rules.js';
import { MediaRange } from './media-range.js';

// The kinds of the core for an Accept value that the grammar does not allow or whose weight is not a qvalue; the
// server answers both with status 400 (HY-116.18).
const INVALID = new Set(['invalid_accept', 'invalid_weight']);

/** @internal */
export class Accept {
  private constructor() {}

  // Parses an Accept field value into its ranges, in order, with rules.accept_ranges of the core. A null value is a
  // request without Accept, which reads as the range that matches every type (HY-116.17). Throws the error of the core
  // with the kind `invalid_accept` or `invalid_weight` for a value that the grammar does not allow, or a weight that is
  // not a qvalue (HY-116.18).
  static parse(value: string | null): MediaRange[] {
    return rules()
      .acceptParse(value)
      .map((range) => new MediaRange(range.type, range.subtype, range.parameters.map(([name, text]): [string, string] => [name, text]), range.weight));
  }

  // Whether an error is the failure of an Accept value that `parse` throws (HY-116.18).
  static isInvalid(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const kind: unknown = Reflect.get(error, 'kind');
    return typeof kind === 'string' && INVALID.has(kind);
  }

  // Returns the type of the highest weight among the given types with that weight in thousandths, the first on a tie, or
  // null and 0 when no type has a weight above 0 (HY-116). A type takes the weight of its most specific matching range,
  // and among the ranges of that specificity the one of the highest weight.
  static best(ranges: readonly MediaRange[], types: readonly string[]): [string | null, number] {
    let selected: string | null = null;
    let best = 0;
    for (const type of types) {
      const weight = Accept.typeWeight(ranges, type);
      if (weight > best) {
        selected = type;
        best = weight;
      }
    }
    return [selected, best];
  }

  // Returns the weight in thousandths that the ranges give a type: the weight of the most specific range that matches it,
  // or 0 when no range matches. A range that names the type matches it whatever its parameters (HY-116).
  private static typeWeight(ranges: readonly MediaRange[], type: string): number {
    const slash = type.indexOf('/');
    const name = type.slice(0, slash);
    const subtype = type.slice(slash + 1);
    let specificity = 0;
    let weight = 0;
    for (const range of ranges) {
      const match = range.type === '*' ? 1 : range.type === name && range.subtype === '*' ? 2 : range.type === name && range.subtype === subtype ? 3 : 0;
      if (match === 0) continue;
      if (match > specificity || (match === specificity && range.weight > weight)) {
        specificity = match;
        weight = range.weight;
      }
    }
    return weight;
  }
}

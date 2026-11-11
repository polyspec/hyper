// The selection of the media type of a request among the page types and the representations of its route (HY-116,
// HY-119), the list of the types that a path serves, and the Content-Type of a representation.
import { Accept } from './accept.js';
import type { MediaRange } from './media-range.js';
import type { Entry } from './representation-entries.js';

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// What a selection chose: the media type, and for a representation its entry and the values of its required parameters
// by their lower-case names in declared order.
/** @internal */
export interface Selected {
  readonly type: string;
  readonly entry: Entry | null;
  readonly values: ReadonlyMap<string, string>;
}

/** @internal */
export class MediaSelection {
  // Returns the type of the highest weight among the page types and the entries, with its entry and the values of its
  // required parameters for a representation, or null when no type has a weight above 0. Among equal weights the first
  // wins: the page types in their order, then the entries in declared order (HY-116.11). Throws InvalidAccept as
  // `Accept.parse` does.
  static select(accept: string | null, pages: readonly string[], entries: readonly Entry[]): Selected | null {
    const ranges = Accept.parse(accept);
    let selected: Selected | null = null;
    let best = 0;
    for (const type of pages) {
      const weight = Accept.typeWeight(ranges, type);
      if (weight > best) {
        selected = { type, entry: null, values: new Map() };
        best = weight;
      }
    }
    for (const entry of entries) {
      const [weight, values] = MediaSelection.entryWeight(ranges, entry);
      if (weight > best) {
        selected = { type: entry.media, entry, values };
        best = weight;
      }
    }
    return selected;
  }

  // Returns the weight in thousandths that the ranges give a declared type, and the parameter values of the range that
  // gives it: the highest weight, and the first in Accept order among equal ones, of the ranges that name the type with
  // a served value for every required parameter and no other parameter (HY-116.8, HY-119).
  static entryWeight(ranges: readonly MediaRange[], entry: Entry): [number, Map<string, string>] {
    const slash = entry.media.indexOf('/');
    const name = entry.media.slice(0, slash);
    const subtype = entry.media.slice(slash + 1);
    let weight = 0;
    let values = new Map<string, string>();
    for (const range of ranges) {
      if (range.type !== name || range.subtype !== subtype) continue;
      // A parameter that a range names twice has its last value.
      const given = new Map(range.parameters);
      if (range.parameters.length !== entry.parameters.length || given.size !== entry.parameters.length) continue;
      const chosen = new Map<string, string>();
      for (const [parameter, served] of entry.parameters) {
        const value = given.get(parameter);
        if (value !== undefined && served.includes(value)) chosen.set(parameter, value);
      }
      if (chosen.size !== entry.parameters.length) continue;
      if (range.weight > weight) {
        weight = range.weight;
        values = chosen;
      }
    }
    return [weight, values];
  }

  // Returns the Content-Type of a representation: its type and, for each required parameter in declared order,
  // `; <name>=<value>` with the name in lower case and the value quoted when it is no token (HY-119.4).
  static contentType(entry: Entry, values: ReadonlyMap<string, string>): string {
    let written = entry.type;
    for (const [parameter] of entry.parameters) {
      const value = values.get(parameter);
      if (value === undefined) throw new Error(`hyper: the selection has no value of the parameter ${parameter} (HY-119)`);
      written += `; ${parameter}=${TOKEN.test(value) ? value : `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`}`;
    }
    return written;
  }

  // Returns the types that a path serves, each on a line that ends with a line feed: the page types, then each entry
  // once for each combination of one served value of every required parameter, ordered by the values of the first
  // parameter, then of the next (HY-116.13).
  static listing(pages: readonly string[], entries: readonly Entry[]): string {
    const lines = [...pages];
    for (const entry of entries) {
      let combinations: [string, string][][] = [[]];
      for (const [parameter, served] of entry.parameters) {
        combinations = combinations.flatMap((combination) => served.map((value): [string, string][] => [...combination, [parameter, value]]));
      }
      for (const combination of combinations) lines.push(MediaSelection.contentType(entry, new Map(combination)));
    }
    return lines.map((line) => `${line}\n`).join('');
  }
}

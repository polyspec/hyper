// The values of a query or a form, without nesting: each name, in the order of its first occurrence, with its values in
// request order; a bracketed name is the name as written (HY-56, HY-57). The core reads them (F-20, F-21).
import { rules } from '../app/core-rules.js';
import { NamedValues } from './named-values.js';

/** @internal */
export class Fields extends NamedValues<string> {
  // Returns fields without names.
  static empty(): Fields {
    return new Fields([], new Map());
  }

  // Parses `name=value&name=value` with form_functions.parse_urlencoded of the core. Returns null when a name or a
  // value is not UTF-8, the kind `invalid` of http-form (HY-42, HY-56).
  static parse(text: Uint8Array): Fields | null {
    try {
      const pairs = rules().formParseUrlencoded(text);
      return new Fields(pairs.map(([name]) => name), new Map(pairs.map(([name, values]) => [name, [...values]])));
    } catch (error) {
      if (error instanceof Error && 'kind' in error && error.kind === 'invalid') return null;
      throw error;
    }
  }
}

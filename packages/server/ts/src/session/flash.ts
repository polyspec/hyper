// Values and changed topics that an action passes to the next request (HY-17, HY-25).
import type { Value } from '../data/values.js';

/** @internal */
export class Flash {
  readonly values: Map<string, Value>;
  readonly changed: string[];

  constructor(values: Map<string, Value>, changed: string[]) {
    this.values = values;
    this.changed = changed;
  }
}

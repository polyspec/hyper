// The values of the template data model that an application gives the server outside a page (HY-44, HY-54): a flash
// value, a kept value and the body of a representation. The server holds no check and no message of its own: the
// binding of the core converts the value and the core writes its JSON text, so a value outside the data model fails
// with the error of the template data model (HY-44.12), and the text read again is the value of the data model.
import { rules } from '../app/core-rules.js';
import type { Value } from './values.js';

/** @internal */
export class DataModel {
  // Returns the value of the data model of an application value: a plain object and a Map with string keys are a Map, a
  // bigint within ±(2^53 − 1) is a number. Any other value fails with the kind and the message of the template data
  // model, and the request fails with HY-43.
  static check(value: unknown): Value {
    return rules().jsonCodecDecode(rules().jsonCodecEncode(value));
  }

  // Returns true for a value of the data model; for example, integers outside ±(2^53 − 1) are not. Every kind of the
  // template data model starts with `data_` (VAL-2, VAL-3, VAL-13, VAL-20).
  static contains(value: unknown): boolean {
    try {
      DataModel.check(value);
      return true;
    } catch (error) {
      const kind: unknown = error instanceof Error ? Reflect.get(error, 'kind') : undefined;
      if (typeof kind === 'string' && kind.startsWith('data_')) return false;
      throw error;
    }
  }
}

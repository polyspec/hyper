// The values of the template data model that an application gives the server outside a page (HY-44, HY-54): a flash
// value, a kept value and the body of a representation. The server holds no check and no message of its own: the
// binding of the core writes the JSON text of the value, so a value outside the data model fails with the error of the
// template data model (HY-44.12).
import { rules } from '../app/core-rules.js';

/** @internal */
export class DataModel {
  // Fails with the kind and the message of the template data model when a value is not a value of the data model
  // (HY-44.6: the host binding, then the check of VAL-19 that the core makes while it writes the JSON text); a value
  // that passes returns nothing. The conversion into the server's `Value` is made by `toValue` (values.ts).
  static check(value: unknown): void {
    rules().jsonCodecEncode(value);
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

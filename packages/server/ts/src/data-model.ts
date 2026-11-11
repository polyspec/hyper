// The values of the template data model that handlers give the server (HY-44, HY-54): the host binding of a value,
// followed by a check that the bound value holds no application object and no string with a lone surrogate.
import { bindValue, NativeObject, type Value } from '@polyspec/template/render';

/** @internal */
export class DataModel {
  // Binds the value, fails when it is not a value of the data model, and returns the bound value. A value of the data
  // model is null, a boolean, a number or a bigint within ±(2^53 − 1), a string without a lone surrogate, an array, a Map
  // with string keys or a plain object; any other value fails, and the request fails with HY-43.
  static check(value: unknown): Value {
    const bound = bindValue(value);
    DataModel.walk(bound);
    return bound;
  }

  // Returns true for a value of the data model; for example, integers outside ±(2^53 − 1) are not.
  static contains(value: unknown): boolean {
    try {
      DataModel.check(value);
      return true;
    } catch {
      return false;
    }
  }

  // Fails when a bound value holds an application object or a string with a lone surrogate.
  private static walk(value: Value): void {
    if (typeof value === 'string' && !value.isWellFormed()) throw new TypeError('hyper: a string with a lone surrogate is not UTF-8');
    if (value instanceof NativeObject) throw new TypeError('hyper: an application object is not a value of the data model');
    if (Array.isArray(value)) value.forEach((item) => DataModel.walk(item));
    if (value instanceof Map) {
      for (const [key, item] of value) {
        DataModel.walk(key);
        DataModel.walk(item);
      }
    }
  }
}

// The values of the template data model that handlers give the server (HY-44, HY-54): the host binding of a value,
// followed by a check that the bound value holds no application object and no string with a lone surrogate.
import { BindError, bindValue, NativeObject, type BindErrorCode, type Value } from '@polyspec/template/render';

// The message of each kind of failure of the binding (HY-44.8); the binding of a value raises no other code.
const MESSAGES = {
  E_DATA_NUMBER_RANGE: 'a number outside ±(2^53 − 1) is not a value of the data model (HY-44)',
  E_DATA_NUMBER_NOT_FINITE: 'a number that is not finite is not a value of the data model (HY-44)',
  E_DATA_INVALID_UTF8: 'a string that is not UTF-8 text is not a value of the data model (HY-44)',
  E_DATA_DEPTH: 'lists and maps that nest deeper than 64 levels are not a value of the data model (HY-44)',
  E_DATA_UNSUPPORTED_TYPE: 'a value or a map key of another type is not a value of the data model (HY-44)',
} as const satisfies Partial<Record<BindErrorCode, string>>;
// The messages by the code of a failure of the binding; a code without a message is not a failure of HY-44.8.
const BY_CODE: Partial<Record<BindErrorCode, string>> = MESSAGES;

// The messages of HY-44.8, by which `contains` tells a value outside the data model from another RangeError, such as a
// stack overflow.
const FAILURES: ReadonlySet<string> = new Set<string>(Object.values(MESSAGES));

/** @internal */
export class DataModel {
  // Binds the value, fails when it is not a value of the data model, and returns the bound value. A value of the data
  // model is null, a boolean, a number or a bigint within ±(2^53 − 1), a string without a lone surrogate, an array, a Map
  // with string keys or a plain object; any other value fails, and the request fails with HY-43.
  static check(value: unknown): Value {
    let bound: Value;
    try {
      bound = bindValue(value);
    } catch (error) {
      // HY-44.8: a failure of the binding is the RangeError of its kind, with the error of the binding as its cause.
      const message = error instanceof BindError ? BY_CODE[error.code] : undefined;
      if (message === undefined) throw error;
      throw new RangeError(message, { cause: error });
    }
    DataModel.walk(bound);
    return bound;
  }

  // Returns true for a value of the data model; for example, integers outside ±(2^53 − 1) are not.
  static contains(value: unknown): boolean {
    try {
      DataModel.check(value);
      return true;
    } catch (error) {
      if (error instanceof RangeError && FAILURES.has(error.message)) return false;
      throw error;
    }
  }

  // Fails when a bound value holds an application object or a string with a lone surrogate.
  private static walk(value: Value): void {
    if (typeof value === 'string' && !value.isWellFormed()) throw new RangeError(MESSAGES.E_DATA_INVALID_UTF8);
    if (value instanceof NativeObject) throw new RangeError(MESSAGES.E_DATA_UNSUPPORTED_TYPE);
    if (Array.isArray(value)) value.forEach((item) => DataModel.walk(item));
    if (value instanceof Map) {
      for (const [key, item] of value) {
        DataModel.walk(key);
        DataModel.walk(item);
      }
    }
  }
}

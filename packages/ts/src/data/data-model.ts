// The values of the template data model that handlers give the server (HY-44, HY-54): the host binding of a value,
// followed by a check that the bound value holds no application object and no string with a lone surrogate.
import { BindError, bindValue, NativeObject, type BindErrorCode, type Value } from '@polyspec/template/render';
import { rules } from '../app/core-rules.js';

// The kind of each failure of the binding (HY-44.8), the kind of the template data model, and its message; the binding
// of a value raises no other code.
const FAILURES = {
  E_DATA_NUMBER_RANGE: ['data_number_range', 'a number outside ±(2^53 − 1) is not a value of the data model (HY-44)'],
  E_DATA_NUMBER_NOT_FINITE: ['data_number_not_finite', 'a number that is not finite is not a value of the data model (HY-44)'],
  E_DATA_INVALID_UTF8: ['data_invalid_utf8', 'a string that is not UTF-8 text is not a value of the data model (HY-44)'],
  E_DATA_DEPTH: ['data_depth', 'lists and maps that nest deeper than 64 levels are not a value of the data model (HY-44)'],
  E_DATA_UNSUPPORTED_TYPE: ['data_unsupported_type', 'a value or a map key of another type is not a value of the data model (HY-44)'],
} as const satisfies Partial<Record<BindErrorCode, readonly [string, string]>>;
// Whether a code of the binding is a failure of HY-44.8; a code without a failure, such as E_DATA_INVALID_JSON, is not.
function isFailure(code: BindErrorCode): code is keyof typeof FAILURES {
  return Object.hasOwn(FAILURES, code);
}

// The kinds of HY-44.8, by which `contains` tells a value outside the data model from another error.
const KINDS: ReadonlySet<string> = new Set<string>(Object.values(FAILURES).map(([kind]) => kind));

// The error of a failure of the data model: of the category type for `data_unsupported_type` and of the category value
// for every other kind, as the template data model gives them (HY-132.3).
function failure(code: keyof typeof FAILURES, cause?: unknown): Error {
  const [kind, message] = FAILURES[code];
  const error = kind === 'data_unsupported_type' ? rules().typeError(message, kind) : rules().valueError(message, kind);
  if (cause !== undefined) Object.defineProperty(error, 'cause', { value: cause, configurable: true, writable: true });
  return error;
}

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
      // HY-44.8: a failure of the binding is the error of its kind, with the error of the binding as its cause.
      if (!(error instanceof BindError) || !isFailure(error.code)) throw error;
      throw failure(error.code, error);
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
      const kind: unknown = error instanceof Error ? Reflect.get(error, 'kind') : undefined;
      if (typeof kind === 'string' && KINDS.has(kind)) return false;
      throw error;
    }
  }

  // Fails when a bound value holds an application object or a string with a lone surrogate.
  private static walk(value: Value): void {
    if (typeof value === 'string' && !value.isWellFormed()) throw failure('E_DATA_INVALID_UTF8');
    if (value instanceof NativeObject) throw failure('E_DATA_UNSUPPORTED_TYPE');
    if (Array.isArray(value)) value.forEach((item) => DataModel.walk(item));
    if (value instanceof Map) {
      for (const [key, item] of value) {
        DataModel.walk(key);
        DataModel.walk(item);
      }
    }
  }
}

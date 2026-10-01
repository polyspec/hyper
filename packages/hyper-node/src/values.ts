// Values of the template data model that loaders and actions give the server (HY-44, HY-54).
import { bind, NativeObject, SafeString, type MapValue, type Value } from '@polyspec/template/render';

export { NativeObject, SafeString, type MapValue, type Value };

export const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

// Data that a loader returns: a plain object or a map with string keys. A plain object keeps the key order of
// JavaScript, which puts integer-like keys first; a Map keeps insertion order.
export type Data = Record<string, unknown> | Map<string, unknown>;

// Converts an application value into a value of the data model: null, a boolean, a number or a bigint within
// ±(2^53 − 1), a string without a lone surrogate, an array, a Map with string keys or a plain object.
// Any other value fails, and the request fails with HY-43 (HY-44).
export function toValue(input: unknown): Value {
  const value = bind(input);
  check(value);
  return value;
}

// Converts loader data into a map of the data model.
export function toMap(input: unknown, label: string): MapValue {
  const value = toValue(input);
  if (!(value instanceof Map)) throw new TypeError(`hyper: ${label} is not a map`);
  return value;
}

function check(value: Value): void {
  if (typeof value === 'string' && !value.isWellFormed()) throw new TypeError('hyper: a string with a lone surrogate is not UTF-8');
  if (value instanceof NativeObject) throw new TypeError('hyper: an application object is not a value of the data model');
  if (Array.isArray(value)) value.forEach(check);
  if (value instanceof Map) {
    for (const [key, item] of value) {
      check(key);
      check(item);
    }
  }
}

// Returns a map with the entries of a base map, replaced or followed by the entries of another map, as PHP
// array_replace does.
export function replaced(base: MapValue, other: MapValue): MapValue {
  const result: MapValue = new Map(base);
  for (const [key, item] of other) result.set(key, item);
  return result;
}

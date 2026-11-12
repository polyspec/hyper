// Values of the template data model that loaders and actions give the server (HY-44, HY-54).
import { NativeObject, SafeString, type MapValue, type Value } from '@polyspec/template/render';
import { DataModel } from './data-model.js';

export { NativeObject, SafeString, type MapValue, type Value };

/** @internal */
export const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

// Data that a loader returns: a plain object or a map with string keys. A plain object keeps the key order of
// JavaScript, which puts integer-like keys first; a Map keeps insertion order.
export type Data = Record<string, unknown> | Map<string, unknown>;

// Converts an application value into a value of the data model: null, a boolean, a number or a bigint within
// ±(2^53 − 1), a string without a lone surrogate, an array, a Map with string keys or a plain object.
// Any other value fails, and the request fails with HY-43 (HY-44).
/** @internal */
export function toValue(input: unknown): Value {
  return DataModel.check(input);
}

// Returns true for a value of the data model as the server stores it: null, a boolean, a number, a string, a safe
// string, an application object, an array of values or a Map of string keys to values.
function isValue(input: unknown): input is Value {
  if (input === null || typeof input === 'boolean' || typeof input === 'number' || typeof input === 'string') return true;
  if (input instanceof SafeString || input instanceof NativeObject) return true;
  if (Array.isArray(input)) return input.every(isValue);
  return isMapValue(input);
}

// Returns true for a Map of string keys to values of the data model.
/** @internal */
export function isMapValue(input: unknown): input is MapValue {
  if (!(input instanceof Map)) return false;
  for (const [key, item] of input) {
    if (typeof key !== 'string' || !isValue(item)) return false;
  }
  return true;
}

// Returns a map with the entries of a base map, replaced or followed by the entries of another map, as PHP
// array_replace does.
/** @internal */
export function replaced(base: MapValue, other: MapValue): MapValue {
  const result: MapValue = new Map(base);
  for (const [key, item] of other) result.set(key, item);
  return result;
}

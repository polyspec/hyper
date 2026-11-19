// Values of the template data model that loaders and actions give the server (HY-44, HY-54).
import { DataModel } from './data-model.js';

// A value of the data model as the server holds it: null, a boolean, a number, a string, an array of values or a Map
// of string keys to values.
export type Value = null | boolean | number | string | Value[] | MapValue;
export type MapValue = Map<string, Value>;

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

// Returns true for a value of the data model as the server stores it: null, a boolean, a number, a string, an array of
// values or a Map of string keys to values.
function isValue(input: unknown): input is Value {
  if (input === null || typeof input === 'boolean' || typeof input === 'number' || typeof input === 'string') return true;
  if (Array.isArray(input)) return input.every(isValue);
  return isMapValue(input);
}

// Returns true for a Map of string keys to values of the data model.
function isMapValue(input: unknown): input is MapValue {
  if (!(input instanceof Map)) return false;
  for (const [key, item] of input) {
    if (typeof key !== 'string' || !isValue(item)) return false;
  }
  return true;
}

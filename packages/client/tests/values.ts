// Narrows the template values that a test expects to have one kind, and fails the test when they do not.
import type { MapValue, Value } from '@polyspec/template/render';

// Returns a value that the test expects to be there, and fails the test when it is not.
export function defined<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`expected ${what}`);
  return value;
}

export function mapOf(value: Value | undefined): MapValue {
  if (!(value instanceof Map)) throw new Error(`expected a map, got ${typeof value}`);
  return value;
}

export function listOf(value: Value | undefined): Value[] {
  if (!Array.isArray(value)) throw new Error(`expected a list, got ${typeof value}`);
  return value;
}

export function stringOf(value: Value | undefined): string {
  if (typeof value !== 'string') throw new Error(`expected a string, got ${typeof value}`);
  return value;
}

// A JSON object of a contract file.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A JSON object whose values are strings, such as the templates of a case by their names.
export function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

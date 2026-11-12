// The narrowing of the inputs of a case: each function returns the value in the form that a step reads, and throws for
// a value of another form. The steps of the Node server and of the browser package read their inputs through them.

// Returns a value of a case that is a string, and fails for any other value.
export function textOf(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`${what} is not a string`);
  return value;
}

// Returns a list of a case, and fails for any other value.
export function listOf(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${what} is not a list`);
  return value;
}

// Returns a map of a case with its string keys, and fails for any other value.
export function mapOf(value: unknown, what: string): Map<string, unknown> {
  if (!(value instanceof Map)) throw new Error(`${what} is not a map`);
  const map = new Map<string, unknown>();
  for (const [key, item] of value) map.set(textOf(key, `a key of ${what}`), item);
  return map;
}

// Returns a map of names to texts of a case as a record, and fails for any other value.
export function textsOf(value: unknown, what: string): Record<string, string> {
  return Object.fromEntries(textMapOf(value, what));
}

// Returns a list of a case whose items are strings, and fails for any other value.
export function stringsOf(value: unknown, what: string): string[] {
  return listOf(value, what).map((item) => textOf(item, `an item of ${what}`));
}

// Returns a map of a case whose values are strings, and fails for any other value.
export function textMapOf(value: unknown, what: string): Map<string, string> {
  return new Map([...mapOf(value, what)].map(([name, item]) => [name, textOf(item, `a value of ${what}`)]));
}

// Returns a list of a case whose items are maps, and fails for any other value.
export function mapsOf(value: unknown, what: string): Map<string, unknown>[] {
  return listOf(value, what).map((item) => mapOf(item, `an item of ${what}`));
}

// Narrows the JSON values that the scripts and their tests read. JSON.parse returns any, so a reader takes the value as
// unknown and states the shape that it reads with these checks; each check names the place of the value when it fails
// (kit K157).

/** A JSON object: an object that is neither null nor an array. */
export type JsonObject = { [key: string]: unknown };

export const isJsonObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

/** `value` as a JSON object; throws a TypeError that names `where` otherwise. */
export function jsonObject(value: unknown, where: string): JsonObject {
  if (!isJsonObject(value)) throw new TypeError(`${where} is not a JSON object: ${JSON.stringify(value)}`);
  return value;
}

/** `value` as a JSON array; throws a TypeError that names `where` otherwise. */
export function jsonArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${where} is not a JSON array: ${JSON.stringify(value)}`);
  return value;
}

/** `value` as an array of JSON objects; throws a TypeError that names `where` and the index otherwise. */
export const jsonObjects = (value: unknown, where: string): JsonObject[] => jsonArray(value, where).map((item, index) => jsonObject(item, `${where}[${index}]`));

/** `value` as a string; throws a TypeError that names `where` otherwise. */
export function jsonString(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new TypeError(`${where} is not a string: ${JSON.stringify(value)}`);
  return value;
}

/** `value` as a number; throws a TypeError that names `where` otherwise. */
export function jsonNumber(value: unknown, where: string): number {
  if (typeof value !== 'number') throw new TypeError(`${where} is not a number: ${JSON.stringify(value)}`);
  return value;
}

/** The JSON object of `text`, read from `where`. */
export const parseJsonObject = (text: string, where: string): JsonObject => jsonObject(JSON.parse(text), where);

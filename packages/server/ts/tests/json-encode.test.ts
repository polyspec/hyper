// The encode cases of contracts/json.json (HY-17, HY-44): JSON text with the bytes of PHP json_encode. PHP and Python pass
// the same cases. Each case is a top-level test named by its id (S6).
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { Value } from '@polyspec/template/render';
import { decodeJson, encodeJson, OutsideNumber, type DecodedValue } from '../src/json.js';
import { list, parsed, record, text } from './support.js';

const fixture = record(parsed(readFileSync(new URL('../../../../contracts/json.json', import.meta.url), 'utf8')));

// Encoding writes every finite number, also one outside the data model, as PHP json_encode does.
function finite(value: DecodedValue): Value {
  if (value instanceof OutsideNumber) return Number(value.literal);
  if (Array.isArray(value)) return value.map(finite);
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, finite(item)]));
  return value;
}

it.each(list(fixture.encode).map(record).map((item) => [text(item.id), item] as const))('%s', (_id, item) => {
  expect(encodeJson(finite(decodeJson(text(item.json))))).toBe(item.expected);
});

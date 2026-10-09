// JSON text with the bytes of PHP json_encode and kept values decoded as PHP json_decode reads them (HY-17,
// HY-38, HY-40, HY-54). PHP passes the same cases of conformance/json.json in JsonTest.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Value } from '@polyspec/template/render';
import { decodeJson, encodeJson, inDataModel, JsonDecodeError, OutsideNumber, type DecodedValue } from '../src/index.js';

const fixture = JSON.parse(readFileSync(new URL('../../../conformance/json.json', import.meta.url), 'utf8')) as {
  encode: { label: string; json: string; expected: string }[];
  decode: { label: string; json: string; result: 'value' | 'outside' | 'error' }[];
};

// Encoding writes every finite number, also one outside the data model, as PHP json_encode does.
function finite(value: DecodedValue): Value {
  if (value instanceof OutsideNumber) return Number(value.literal);
  if (Array.isArray(value)) return value.map(finite);
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, finite(item)]));
  return value;
}

describe('encodeJson conformance', () => {
  it.each(fixture.encode.map((item) => [item.label, item] as const))('%s', (_label, item) => {
    expect(encodeJson(finite(decodeJson(item.json)))).toBe(item.expected);
  });
});

describe('decodeJson conformance', () => {
  it.each(fixture.decode.map((item) => [item.label, item] as const))('%s', (_label, item) => {
    let result: string;
    try {
      result = inDataModel(decodeJson(item.json)) ? 'value' : 'outside';
    } catch (error) {
      if (!(error instanceof JsonDecodeError)) throw error;
      result = 'error';
    }
    expect(result).toBe(item.result);
  });
});

describe('PHP json_encode bytes', () => {
  it('escapes U+2028 and U+2029, which JSON.stringify writes unescaped', () => {
    expect(JSON.stringify('  ')).toBe('"  "');
    expect(encodeJson('  ')).toBe('"\\u2028\\u2029"');
  });

  it('writes floats as PHP does where JSON.stringify differs', () => {
    expect([1e17, 1e-5, 5e-324, -0].map((value) => JSON.stringify(value))).toEqual(['100000000000000000', '0.00001', '5e-324', '0']);
    expect([1e17, 1e-5, 5e-324, -0].map(encodeJson)).toEqual(['1.0e+17', '1.0e-5', '5.0e-324', '-0']);
    expect([1e21, 2.5e-7, 123.456, 2 ** 60].map(encodeJson)).toEqual(['1.0e+21', '2.5e-7', '123.456', '1.152921504606847e+18']);
  });

  it('writes empty maps as objects and keeps map order', () => {
    expect(encodeJson(new Map())).toBe('{}');
    expect(encodeJson(new Map<string, Value>([['b', new Map()], ['a', []]]))).toBe('{"b":{},"a":[]}');
  });

  it('fails a string with a lone surrogate, which is not UTF-8 (HY-44)', () => {
    expect(() => encodeJson('a\uDC00')).toThrow('lone surrogate');
    expect(() => encodeJson(Number.POSITIVE_INFINITY)).toThrow('not finite');
  });
});

describe('PHP json_decode limits', () => {
  it('accepts 511 nested containers and rejects 512', () => {
    expect(() => decodeJson(`${'['.repeat(511)}${']'.repeat(511)}`)).not.toThrow();
    expect(() => decodeJson(`${'['.repeat(512)}${']'.repeat(512)}`)).toThrow(JsonDecodeError);
    expect(() => decodeJson(`${'{"a":'.repeat(512)}1${'}'.repeat(512)}`)).toThrow(JsonDecodeError);
  });

  it('reads an integer literal as an integer and a later duplicate key replaces the value in place', () => {
    expect(encodeJson(decodeJson('-0') as number)).toBe('0');
    expect(decodeJson('{"a":1,"b":2,"a":3}')).toEqual(new Map([['a', 3], ['b', 2]]));
  });
});

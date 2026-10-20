// The cases of contracts/keep.json (HY-38, HY-41): the server selects kept values that conform, and the selected values applied to
// the data give the expected data. PHP and Python pass the same cases. Each case is a top-level test named by its id (S6).
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { applyKept, copyValue } from '@polyspec/hyper-client';
import { parseJson, type Value } from '@polyspec/template/render';
import { selectKept } from '../src/kept.js';
import { requireMap } from '../src/values.js';

const fixture = requireMap(parseJson(readFileSync(new URL('../../../../contracts/keep.json', import.meta.url), 'utf8')), 'contracts/keep.json');
const cases = list(fixture.get('cases'), 'cases').map((value) => requireMap(value, 'a case'));

// Returns a value of the contract that is a list; another value fails the test.
function list(value: Value | undefined, label: string): Value[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} is not a list`);
  return value;
}

// Returns a value of the contract that is a string; another value fails the test.
function string(value: Value | undefined, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} is not a string`);
  return value;
}

// Each case is a top-level test named by its id (S6).
it.each(cases.map((item) => [string(item.get('id'), 'id'), item] as const))('%s', (_id, item) => {
    const data = requireMap(item.get('data') ?? null, 'data');
    const kept = list(item.get('kept'), 'kept').map((entry): [string, Value] => {
      const [path, value] = list(entry, 'a kept pair');
      if (value === undefined) throw new TypeError('a kept pair has no value');
      return [string(path, 'a kept path'), value];
    });
    const selected = selectKept(data, kept);
    const applied = requireMap(copyValue(data), 'data');
    applyKept(applied, [...selected]);
    expect(applied).toEqual(item.get('expected'));
});

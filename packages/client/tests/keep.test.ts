import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseJson } from '@polyspec/template';
import { applyKept, keepCookieName } from '../src/keep.js';
import { listOf, mapOf, stringOf } from './values.js';

const fixture = mapOf(parseJson(readFileSync(new URL('../../../contracts/keep.json', import.meta.url), 'utf8')));
const cases = listOf(fixture.get('cases')).map((value) => mapOf(value));

// HY-41: these are the same cases that the PHP implementation passes. Each case is a top-level test named by its id (S6).
it.each(cases.map((item) => [stringOf(item.get('id')), item] as const))('%s', (_id, item) => {
  const data = mapOf(item.get('data'));
  const kept = listOf(item.get('kept')).map((entry) => {
    const [path, value] = listOf(entry);
    if (value === undefined) throw new Error('a kept entry has no value');
    return [stringOf(path), value] as const;
  });
  applyKept(data, kept);
  expect(data).toEqual(item.get('expected'));
});

describe('kept cookie name', () => {
  it('uses the __Host- prefix on HTTPS so that another host cannot set it (HY-39)', () => {
    expect(keepCookieName(true)).toBe('__Host-hy-keep');
    expect(keepCookieName(false)).toBe('hy-keep');
  });
});

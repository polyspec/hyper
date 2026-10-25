import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseJson } from '@polyspec/template';
import { applyKept, browserStorage, keepCookieName } from '../src/keep.js';
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
  it('uses the __Host- prefix on HTTPS so that another host cannot set it (HYC-13)', () => {
    expect(keepCookieName(true)).toBe('__Host-hy-keep');
    expect(keepCookieName(false)).toBe('hy-keep');
  });
});

// H25.74: a keep cookie whose value is no percent-encoded JSON text keeps nothing, so a write starts from an empty map; the read takes
// only the URIError of its percent-encoding and the BindError of a text that is no JSON value.
describe('kept cookie value', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it.each(['%E0%A4%A', '%7B'])('a cookie value %j that is no percent-encoded JSON text keeps nothing', (value) => {
    const page = { cookie: `hy-keep=${value}` };
    vi.stubGlobal('window', { location: { protocol: 'http:' } });
    vi.stubGlobal('document', page);
    browserStorage().write('cookie', 'r', '/a', '1');
    expect(page.cookie).toMatch(/^hy-keep=%7B%22r%22%3A%7B%22%2Fa%22%3A1%7D%7D; Path=\/; SameSite=Lax; /);
  });
});

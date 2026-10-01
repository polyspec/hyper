import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseJson, type MapValue, type Value } from '@polyspec/template';
import { applyKept } from '../src/keep.js';

const fixture = parseJson(readFileSync(new URL('../../../conformance/keep.json', import.meta.url), 'utf8')) as MapValue;
const cases = (fixture.get('cases') as Value[]).map((value) => value as MapValue);

// HY-41: these are the same cases that the PHP implementation passes.
describe('applyKept conformance', () => {
  it.each(cases.map((item) => [item.get('label') as string, item] as const))('%s', (_label, item) => {
    const data = item.get('data') as MapValue;
    const kept = (item.get('kept') as Value[][]).map(([path, value]) => [path as string, value as Value] as const);
    applyKept(data, kept);
    expect(data).toEqual(item.get('expected'));
  });
});

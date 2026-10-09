// The cases of packages/hyper-php/tests/KeptTest.php: the server selects kept values that conform, and the
// selected values applied to the data give the expected data (HY-38, HY-41).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyKept, copyValue } from '@polyspec/hyper-client';
import { parseJson, type MapValue, type Value } from '@polyspec/template/render';
import type { DecodedValue } from '../src/index.js';
import { selectKept } from '../src/kept.js';

const fixture = parseJson(readFileSync(new URL('../../../conformance/keep.json', import.meta.url), 'utf8')) as MapValue;
const cases = (fixture.get('cases') as Value[]).map((value) => value as MapValue);

describe('selectKept conformance', () => {
  it.each(cases.map((item) => [item.get('label') as string, item] as const))('%s', (_label, item) => {
    const data = item.get('data') as MapValue;
    const kept = (item.get('kept') as Value[][]).map(([path, value]) => [path as string, value as DecodedValue] as [string, DecodedValue]);
    const selected = selectKept(data, kept);
    const applied = copyValue(data) as MapValue;
    applyKept(applied, [...selected]);
    expect(applied).toEqual(item.get('expected'));
  });

  it('walks into maps and leaves the loader data unchanged', () => {
    const data: MapValue = new Map([['notice', new Map<string, Value>([['closed', false]])]]);
    expect(selectKept(data, [['notice.closed', true]])).toEqual(new Map([['notice.closed', true]]));
    expect(data).toEqual(new Map([['notice', new Map([['closed', false]])]]));
  });
});

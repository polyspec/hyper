// The selection of kept values beyond the cases of contracts/keep.json (HY-38).
import { expect, it } from 'vitest';
import { type MapValue, type Value } from '@polyspec/template/render';
import { selectKept } from '../src/kept.js';

it('walks into maps and leaves the loader data unchanged', () => {
    const data: MapValue = new Map([['notice', new Map<string, Value>([['closed', false]])]]);
    expect(selectKept(data, [['notice.closed', true]])).toEqual(new Map([['notice.closed', true]]));
    expect(data).toEqual(new Map([['notice', new Map([['closed', false]])]]));
});

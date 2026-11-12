// The steps of contracts/keep.json (HY-38): the data that a case keeps, and the kept values that the server sends.
import { isDeepStrictEqual } from 'node:util';
import { Kept } from '../../src/kept.js';
import type { MapValue, Value } from '../../src/values.js';
import type { CaseReader } from '../case-reader.js';

// The region data of a case, a map of the case file.
function dataOf(reader: CaseReader): MapValue {
  const data = reader.input('data');
  if (!(data instanceof Map)) throw new TypeError('the case data is not a map');
  return data as MapValue;
}

function pairs(reader: CaseReader): [string, Value][] {
  const kept = reader.input('kept');
  if (!Array.isArray(kept)) return [];
  return kept.flatMap((entry: Value): [string, Value][] => {
    if (!Array.isArray(entry)) return [];
    const [path, value] = entry;
    return typeof path === 'string' && value !== undefined ? [[path, value]] : [];
  });
}

export const steps = {
  cases(reader: CaseReader): void {
    const data = dataOf(reader);
    reader.compare('expected', Kept.apply(data, pairs(reader)));
  },
  select(reader: CaseReader): void {
    const data = dataOf(reader);
    const before = structuredClone(data);
    reader.compare('selected', Kept.select(data, pairs(reader)));
    reader.compare('unchanged', isDeepStrictEqual(data, before));
  },
};

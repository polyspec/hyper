// The cases step of contracts/keep.json (HY-38): the kept values that conform, applied to the data, give the
// expected data.
import { applyKept, copyValue } from '@polyspec/hyper-client';
import type { Value } from '@polyspec/template/render';
import { selectKept } from '../../src/kept.js';
import { requireMap } from '../../src/values.js';
import type { CaseReader } from '../case-reader.js';

export const steps = {
  cases(reader: CaseReader): void {
    const data = requireMap(reader.input('data') as Value, 'data');
    const kept = (reader.input('kept') as Value[]).map((entry): [string, Value] => {
      const [path, value] = entry as Value[];
      return [path as string, value as Value];
    });
    const applied = requireMap(copyValue(data), 'data');
    applyKept(applied, [...selectKept(data, kept)]);
    reader.compare('expected', applied);
  },
};

import { Csrf } from '../../src/csrf.ts';
import type { CaseReader } from '../case-reader.ts';

function masked(token: string): string {
  return new Csrf('k').mask(token);
}

export const steps = {
  mask(reader: CaseReader): void {
    reader.compare('expected', masked('token'));
  },
};

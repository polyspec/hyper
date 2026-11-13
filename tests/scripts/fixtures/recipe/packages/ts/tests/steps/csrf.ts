import { Csrf } from '../../src/session/csrf.ts';
import type { CaseReader } from '../case-reader.ts';

function masked(token: string): string {
  return new Csrf('k').mask(token);
}

// The step of a section may be a function of the file that the object names.
function mask(reader: CaseReader): void {
  reader.compare('expected', masked('token'));
}

export const steps = {
  mask,
};

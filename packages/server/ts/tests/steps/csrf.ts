// The steps of contracts/csrf.json (HY-24): the masked values of a token and their verification.
import { Csrf } from '../../src/csrf.js';
import type { CaseReader } from '../case-reader.js';

function text(reader: CaseReader, name: string): string {
  const value = reader.input(name);
  if (typeof value !== 'string') throw new Error(`the case field ${name} is not a string`);
  return value;
}

export const steps = {
  mask(reader: CaseReader): void {
    reader.compare('value', Csrf.mask(text(reader, 'token'), text(reader, 'mask')));
  },
  verify(reader: CaseReader): void {
    reader.compare('valid', Csrf.verify(text(reader, 'token'), text(reader, 'value')));
  },
  masked(reader: CaseReader): void {
    const token = text(reader, 'token');
    const first = Csrf.masked(token);
    const second = Csrf.masked(token);
    reader.compare('hexadecimal', /^[0-9a-f]{128}$/u.test(first));
    reader.compare('distinct', first !== second);
    reader.compare('valid', Csrf.verify(token, first) && Csrf.verify(token, second));
  },
};

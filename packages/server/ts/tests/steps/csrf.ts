// The mask and verify steps of contracts/csrf.json (HY-24).
import { maskToken, verifyToken } from '../../src/csrf.js';
import type { CaseReader } from '../case-reader.js';

export const steps = {
  mask(reader: CaseReader): void {
    reader.compare('value', maskToken(reader.input('token') as string, reader.input('mask') as string));
  },
  verify(reader: CaseReader): void {
    reader.compare('valid', verifyToken(reader.input('token') as string, reader.input('value') as string));
  },
};

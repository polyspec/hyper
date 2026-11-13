// The steps of contracts/csrf.json (HY-24): the masked values of a token and their verification.
import { Csrf } from '../../src/session/csrf.js';
import type { CaseReader } from '../case-reader.js';

function text(reader: CaseReader, name: string): string {
  const value = reader.input(name);
  if (typeof value !== 'string') throw new Error(`the case field ${name} is not a string`);
  return value;
}

// Returns the result of a call, or the message of the RangeError with which it fails; any other error is thrown.
function failureOf<T>(call: () => T): { result: T | null; error: string | null } {
  try {
    return { result: call(), error: null };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { result: null, error: error.message };
  }
}

export const steps = {
  // Masks the token with the mask, or records the message of the error with which it fails (HY-24.9).
  mask(reader: CaseReader): void {
    const token = text(reader, 'token');
    const mask = text(reader, 'mask');
    const outcome = failureOf(() => Csrf.mask(token, mask));
    reader.compare('value', outcome.result);
    reader.compare('error', outcome.error);
  },
  // Verifies the value against the token, or records the message of the error with which it fails (HY-24.9).
  verify(reader: CaseReader): void {
    const token = text(reader, 'token');
    const value = text(reader, 'value');
    const outcome = failureOf(() => Csrf.verify(token, value));
    reader.compare('valid', outcome.result);
    reader.compare('error', outcome.error);
  },
  // Gives the digest of the masked value, or records the message of the error with which it fails (HY-24.13).
  browser(reader: CaseReader): void {
    const value = text(reader, 'value');
    const outcome = failureOf(() => Csrf.browserOf(value));
    reader.compare('browser', outcome.result);
    reader.compare('error', outcome.error);
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

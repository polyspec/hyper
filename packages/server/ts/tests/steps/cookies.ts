// The steps of contracts/cookies.json (HY-129): a header is text whose characters U+0000 to U+00FF are its bytes.
import { Cookies } from '../../src/cookies.js';
import type { CaseReader } from '../case-reader.js';

export const steps = {
  parse(reader: CaseReader): void {
    const header = reader.input('header');
    reader.compare('cookies', Object.fromEntries(Cookies.parse(typeof header === 'string' ? header : null)));
  },
};

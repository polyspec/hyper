// The steps of contracts/cookies.json (HY-129): each line is text whose characters U+0000 to U+00FF are its bytes, and
// `header` is one line, as a host whose runtime joins the lines passes it (HY-129.15).
import { Cookies } from '../../src/http/cookies.js';
import type { CaseReader } from '../case-reader.js';

export const steps = {
  parse(reader: CaseReader): void {
    const lines = reader.has('lines') ? reader.input('lines') : [reader.input('header')].filter((line) => line !== null);
    if (!Array.isArray(lines) || !lines.every((line): line is string => typeof line === 'string')) throw new Error('the lines of the case are not texts');
    reader.compare('cookies', Object.fromEntries(Cookies.parse(lines)));
  },
};
